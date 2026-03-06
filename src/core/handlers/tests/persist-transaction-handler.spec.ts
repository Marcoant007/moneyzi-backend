import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PersistTransactionHandler } from '../persist-transaction-handler'
import type { UserRepository } from '@/application/repositories/user-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CreditCardRepository } from '@/core/repositories/credit-card-repository'
import type { TransactionMessage } from '@/core/types/transaction-message'

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
    default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCard(overrides: Partial<{
    id: string
    userId: string
    dueDay: number | null
    closingDay: number | null
}> = {}) {
    return {
        id: 'card-inter',
        userId: 'user-1',
        dueDay: 10,
        closingDay: 1,
        ...overrides,
    }
}

function makeDeps(cardOverrides?: Parameters<typeof makeCard>[0]) {
    const userRepository = {
        findById: vi.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as UserRepository

    const transactionRepository = {
        create: vi.fn().mockResolvedValue(undefined),
    } as unknown as TransactionRepository

    const creditCardRepository = {
        findById: vi.fn().mockResolvedValue(makeCard(cardOverrides)),
    } as unknown as CreditCardRepository

    return { userRepository, transactionRepository, creditCardRepository }
}

function makeTx(overrides: Partial<TransactionMessage> = {}): TransactionMessage {
    return {
        userId: 'user-1',
        name: 'EasyMarket VILA VELHA BRA',
        amount: 10.99,
        date: new Date('2026-02-15'),
        type: 'EXPENSE',
        category: 'FOOD',
        paymentMethod: 'CREDIT_CARD',
        creditCardId: 'card-inter',
        isCreditCardInvoice: false,
        ...overrides,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('PersistTransactionHandler — dueDate em importação de fatura', () => {

    it('usa o mês seguinte ao anchorDate quando isCreditCardInvoice=true (fatura Inter fev → mar)', async () => {
        // Fatura de fevereiro: anchorDate = 28/02/2026, dueDay = 10 → deve gerar 10/03/2026
        const deps = makeDeps({ dueDay: 10, closingDay: 1 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date('2026-02-15'),
            isCreditCardInvoice: true,
            statementAnchorDate: new Date('2026-02-28'),
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        expect(saved.dueDate).toBeDefined()
        const due = saved.dueDate as Date
        expect(due.getFullYear()).toBe(2026)
        expect(due.getMonth()).toBe(2)   // 0-indexed: março = 2
        expect(due.getDate()).toBe(10)
    })

    it('todas as transações da mesma fatura recebem o mesmo dueDate independente da date', async () => {
        // Parcela antiga com date em ago/2025 mas importada na fatura de fev/2026
        const deps = makeDeps({ dueDay: 10, closingDay: 1 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const transactions = [
            makeTx({ date: new Date('2025-08-11'), isCreditCardInvoice: true, statementAnchorDate: new Date('2026-02-28') }),
            makeTx({ date: new Date('2026-01-14'), isCreditCardInvoice: true, statementAnchorDate: new Date('2026-02-28') }),
            makeTx({ date: new Date('2026-02-22'), isCreditCardInvoice: true, statementAnchorDate: new Date('2026-02-28') }),
        ]

        for (const tx of transactions) {
            vi.mocked(deps.transactionRepository.create).mockClear()
            await sut.handle(tx)
            const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
            const due = saved.dueDate as Date
            expect(due.getMonth()).toBe(2)    // março
            expect(due.getDate()).toBe(10)
            expect(due.getFullYear()).toBe(2026)
        }
    })

    it('respeitavirada de ano: fatura de dez/2025 vence em jan/2026', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: 1 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date('2025-12-15'),
            isCreditCardInvoice: true,
            statementAnchorDate: new Date('2025-12-31'),
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getFullYear()).toBe(2026)
        expect(due.getMonth()).toBe(0)   // janeiro
        expect(due.getDate()).toBe(10)
    })

    it('não usa closingDay no cálculo de fatura — closingDay=1 não pode mandar tudo para abril', async () => {
        // BUG original: com closingDay=1, txDay(15) > closingDay(1) → +2 → Abril
        // Correto: isCreditCardInvoice ignora closingDay → anchorDate → Março
        const deps = makeDeps({ dueDay: 10, closingDay: 1 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date('2026-02-15'),
            isCreditCardInvoice: true,
            statementAnchorDate: new Date('2026-02-28'),
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        // NÃO pode ser Abril (mês 3)
        expect(due.getMonth()).not.toBe(3)
        // Deve ser Março (mês 2)
        expect(due.getMonth()).toBe(2)
    })
})

describe('PersistTransactionHandler — dueDate em transação manual de cartão', () => {

    it('txDay <= closingDay → +1 mês (compra no dia 1, fecha dia 28 → paga no mês seguinte)', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: 28 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        // Compra dia 15/fev (15 ≤ 28) → +1 → Março/10
        const tx = makeTx({
            date: new Date(2026, 1, 15, 12, 0, 0, 0),
            isCreditCardInvoice: false,
            statementAnchorDate: undefined,
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getMonth()).toBe(2)   // março
        expect(due.getDate()).toBe(10)
    })

    it('txDay > closingDay → +2 meses (compra dia 6, fecha dia 5 → paga em 2 meses)', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: 5 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        // Compra dia 06/fev (6 > 5) → +2 → Abril/10
        const tx = makeTx({
            date: new Date(2026, 1, 6, 12, 0, 0, 0),   // 06/feb local noon — avoids UTC-3 day shift
            isCreditCardInvoice: false,
            statementAnchorDate: undefined,
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getMonth()).toBe(3)   // abril
        expect(due.getDate()).toBe(10)
    })

    it('txDay <= closingDay → +1 mês (compra dia 4, fecha dia 5 → paga no mês seguinte)', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: 5 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        // Compra dia 04/fev (4 ≤ 5) → +1 → Março/10
        const tx = makeTx({
            date: new Date(2026, 1, 4, 12, 0, 0, 0),
            isCreditCardInvoice: false,
            statementAnchorDate: undefined,
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getMonth()).toBe(2)   // março
        expect(due.getDate()).toBe(10)
    })

    it('sem closingDay: txDay > dueDay → +1 mês', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: null })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date(2026, 1, 15, 12, 0, 0, 0),   // 15 > 10
            isCreditCardInvoice: false,
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getMonth()).toBe(2)   // março
        expect(due.getDate()).toBe(10)
    })

    it('sem closingDay: txDay <= dueDay → mesmo mês', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: null })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date(2026, 1, 5, 12, 0, 0, 0),   // 5 <= 10
            isCreditCardInvoice: false,
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getMonth()).toBe(1)   // fevereiro (mesmo mês)
        expect(due.getDate()).toBe(10)
    })
})

describe('PersistTransactionHandler — dueDate fuso horário', () => {

    it('dueDate é salvo com hora 12:00 local para não mudar de dia em UTC-3', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: 1 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            isCreditCardInvoice: true,
            statementAnchorDate: new Date('2026-02-28'),
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        // Deve ser meio-dia (12:00) para não sofrer com UTC-3
        expect(due.getHours()).toBe(12)
    })

    it('computeCardDueDate também usa hora 12:00', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: 28 })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date(2026, 1, 15, 12, 0, 0, 0),
            isCreditCardInvoice: false,
        })

        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due.getHours()).toBe(12)
    })
})

describe('PersistTransactionHandler — dueDate ausente', () => {

    it('dueDate é null quando não há creditCardId', async () => {
        const deps = makeDeps()
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({ creditCardId: undefined })
        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        expect(saved.dueDate).toBeNull()
    })

    it('dueDate é null quando cartão não tem dueDay configurado', async () => {
        const deps = makeDeps({ dueDay: null })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({ isCreditCardInvoice: true, statementAnchorDate: new Date('2026-02-28') })
        await sut.handle(tx)

        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        expect(saved.dueDate).toBeNull()
    })

    it('cai no computeCardDueDate quando isCreditCardInvoice=true mas statementAnchorDate ausente', async () => {
        const deps = makeDeps({ dueDay: 10, closingDay: null })
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        const tx = makeTx({
            date: new Date(2026, 1, 15, 12, 0, 0, 0),
            isCreditCardInvoice: true,
            statementAnchorDate: undefined,
        })

        await sut.handle(tx)
        const saved = vi.mocked(deps.transactionRepository.create).mock.calls[0][0]
        const due = saved.dueDate as Date
        expect(due).toBeDefined()
        expect(due.getMonth()).toBe(2)
        expect(due.getDate()).toBe(10)
    })
})

describe('PersistTransactionHandler — validações', () => {

    it('lança erro quando userId está ausente', async () => {
        const deps = makeDeps()
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        await expect(sut.handle(makeTx({ userId: '' }))).rejects.toThrow('Transacao incompleta')
    })

    it('lança erro quando name está ausente', async () => {
        const deps = makeDeps()
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        await expect(sut.handle(makeTx({ name: undefined }))).rejects.toThrow('Transacao incompleta')
    })

    it('lança erro quando amount é NaN', async () => {
        const deps = makeDeps()
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        await expect(sut.handle(makeTx({ amount: NaN }))).rejects.toThrow('Transacao incompleta')
    })

    it('lança erro quando usuário não existe no banco', async () => {
        const deps = makeDeps()
        vi.mocked(deps.userRepository.findById).mockResolvedValue(null)
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        await expect(sut.handle(makeTx())).rejects.toThrow('User not found')
    })

    it('lança erro quando type/category/paymentMethod não foram classificados', async () => {
        const deps = makeDeps()
        const sut = new PersistTransactionHandler(
            deps.userRepository, deps.transactionRepository, deps.creditCardRepository,
        )

        await expect(
            sut.handle(makeTx({ type: undefined, category: undefined, paymentMethod: undefined }))
        ).rejects.toThrow('Transacao sem classificacao completa')
    })
})
