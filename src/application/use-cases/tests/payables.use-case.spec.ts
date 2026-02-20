import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GetPayablesReceivablesUseCase } from '../payables-use-case/get-payables-receivables.use-case'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<{
    id: string
    name: string
    description: string | null
    amount: number
    dueDate: Date
    paymentStatus: 'PENDING' | 'PAID'
    paidAt: Date | null
    isRecurring: boolean
    category: string
    creditCardId: string | null
    creditCard: { name: string } | null
    [key: string]: unknown
}> = {}) {
    return {
        id: 'tx-1',
        name: 'Conta de luz',
        description: null,
        amount: 100,
        dueDate: new Date('2026-03-15'),
        paymentStatus: 'PENDING' as const,
        paidAt: null,
        isRecurring: false,
        category: 'utility',
        creditCardId: null,
        creditCard: null,
        ...overrides,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GetPayablesReceivablesUseCase — effectiveStatus', () => {
    let sut: GetPayablesReceivablesUseCase

    beforeEach(() => {
        // We only test the pure helper; no repo call needed here
        const repo = {} as unknown as TransactionRepository
        sut = new GetPayablesReceivablesUseCase(repo)
    })

    const futureDate = new Date('2099-12-31')
    const pastDate = new Date('2020-01-01')
    const today = new Date()

    it('PAID transaction → effectiveStatus PAID regardless of dueDate', () => {
        expect(sut.computeEffectiveStatus('PAID', pastDate, today)).toBe('PAID')
        expect(sut.computeEffectiveStatus('PAID', futureDate, today)).toBe('PAID')
    })

    it('PENDING + future dueDate → PENDING', () => {
        expect(sut.computeEffectiveStatus('PENDING', futureDate, today)).toBe('PENDING')
    })

    it('PENDING + past dueDate → OVERDUE', () => {
        expect(sut.computeEffectiveStatus('PENDING', pastDate, today)).toBe('OVERDUE')
    })
})

describe('GetPayablesReceivablesUseCase — card grouping', () => {
    let sut: GetPayablesReceivablesUseCase

    beforeEach(() => {
        const repo = {} as unknown as TransactionRepository
        sut = new GetPayablesReceivablesUseCase(repo)
    })

    const today = new Date('2026-03-01')

    it('sums amounts correctly for same creditCardId + month', () => {
        const transactions = [
            makeTx({ id: 'a', creditCardId: 'card-1', dueDate: new Date('2026-03-10'), amount: 200, creditCard: { name: 'Nubank' } }),
            makeTx({ id: 'b', creditCardId: 'card-1', dueDate: new Date('2026-03-15'), amount: 300, creditCard: { name: 'Nubank' } }),
        ]
        const stmts = sut.groupCardStatements(transactions, today)
        expect(stmts).toHaveLength(1)
        expect(stmts[0].totalAmount).toBe(500)
    })

    it('includes all transactionIds in the group', () => {
        const transactions = [
            makeTx({ id: 'a', creditCardId: 'card-1', dueDate: new Date('2026-03-10'), amount: 100, creditCard: { name: 'X' } }),
            makeTx({ id: 'b', creditCardId: 'card-1', dueDate: new Date('2026-03-20'), amount: 50, creditCard: { name: 'X' } }),
        ]
        const stmts = sut.groupCardStatements(transactions, today)
        expect(stmts[0].transactionIds).toEqual(expect.arrayContaining(['a', 'b']))
    })

    it('group effectiveStatus PAID when all items are PAID', () => {
        const transactions = [
            makeTx({ id: 'a', creditCardId: 'card-1', dueDate: new Date('2026-03-10'), paymentStatus: 'PAID', creditCard: { name: 'X' } }),
            makeTx({ id: 'b', creditCardId: 'card-1', dueDate: new Date('2026-03-10'), paymentStatus: 'PAID', creditCard: { name: 'X' } }),
        ]
        const stmts = sut.groupCardStatements(transactions, today)
        expect(stmts[0].effectiveStatus).toBe('PAID')
    })

    it('group effectiveStatus OVERDUE when PENDING + past dueDate', () => {
        const pastDate = new Date('2020-01-10')
        const transactions = [
            makeTx({ id: 'a', creditCardId: 'card-1', dueDate: pastDate, paymentStatus: 'PENDING', creditCard: { name: 'X' } }),
        ]
        const stmts = sut.groupCardStatements(transactions, today)
        expect(stmts[0].effectiveStatus).toBe('OVERDUE')
    })

    it('splits different cards into separate statements', () => {
        const transactions = [
            makeTx({ id: 'a', creditCardId: 'card-1', dueDate: new Date('2026-03-10'), creditCard: { name: 'Nubank' } }),
            makeTx({ id: 'b', creditCardId: 'card-2', dueDate: new Date('2026-03-10'), creditCard: { name: 'Inter' } }),
        ]
        const stmts = sut.groupCardStatements(transactions, today)
        expect(stmts).toHaveLength(2)
    })
})

describe('GetPayablesReceivablesUseCase — full execute', () => {
    let repo: TransactionRepository
    let sut: GetPayablesReceivablesUseCase

    beforeEach(() => {
        repo = {
            findPayables: vi.fn(),
            findReceivables: vi.fn(),
        } as unknown as TransactionRepository
        sut = new GetPayablesReceivablesUseCase(repo)
    })

    it('returns PENDING + OVERDUE amounts in pending total', async () => {
        const pastDate = new Date('2020-01-01')
        const futureDate = new Date('2099-12-31')

        vi.mocked(repo.findPayables).mockResolvedValue([
            makeTx({ id: 'a', amount: 100, dueDate: futureDate, paymentStatus: 'PENDING' }) as any,
            makeTx({ id: 'b', amount: 200, dueDate: pastDate, paymentStatus: 'PENDING' }) as any, // overdue
        ])
        vi.mocked(repo.findReceivables).mockResolvedValue([])

        const result = await sut.execute({ userId: 'u1' })

        // Both overdue and pending count toward "pending"
        expect(result.payables.totals.pending).toBe(300)
        expect(result.payables.totals.overdue).toBe(200)
        expect(result.payables.totals.paid).toBe(0)
    })

    it('computes netProjection = receivables.pending - payables.pending', async () => {
        vi.mocked(repo.findPayables).mockResolvedValue([
            makeTx({ id: 'p1', amount: 400, dueDate: new Date('2099-12-31'), paymentStatus: 'PENDING' }) as any,
        ])
        vi.mocked(repo.findReceivables).mockResolvedValue([
            makeTx({ id: 'r1', amount: 1000, dueDate: new Date('2099-12-31'), paymentStatus: 'PENDING' }) as any,
        ])

        const result = await sut.execute({ userId: 'u1' })
        expect(result.summary.netProjection).toBe(600)
    })
})
