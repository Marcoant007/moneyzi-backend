import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiCategorizationHandler } from '../gemini-categorization-handler'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { TransactionMessage } from '@/core/types/transaction-message'

const mocks = vi.hoisted(() => ({
    detectTransactionDataWithIA: vi.fn(),
}))

vi.mock('@/core/gemini/detect-transaction-data-with-ia', () => ({
    detectTransactionDataWithIA: mocks.detectTransactionDataWithIA,
}))

function makeRepo(overrides: Partial<CategoryRepository> = {}): CategoryRepository {
    return {
        listByUserId: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        ...overrides,
    } as unknown as CategoryRepository
}

function makeTx(overrides: Partial<TransactionMessage> = {}): TransactionMessage {
    return {
        userId: 'user-1',
        name: 'EasyMarket VILA VELHA BRA',
        amount: 10.99,
        date: new Date('2026-02-15'),
        type: undefined,
        category: undefined,
        paymentMethod: undefined,
        ...overrides,
    }
}

describe('GeminiCategorizationHandler', () => {
    let sut: GeminiCategorizationHandler
    let repo: CategoryRepository

    beforeEach(() => {
        vi.clearAllMocks()
        repo = makeRepo()
        sut = new GeminiCategorizationHandler(repo)

        // Default Gemini response
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'EXPENSE',
            category: 'FOOD',
            paymentMethod: 'CREDIT_CARD',
            categoryId: undefined,
            categoryName: 'Supermercado',
        })
    })


    it('força type=EXPENSE em importação de fatura mesmo que Gemini diga DEPOSIT', async () => {
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'DEPOSIT',
            category: 'OTHER',
            paymentMethod: 'PIX',
            categoryId: undefined,
            categoryName: undefined,
        })

        const tx = makeTx({
            name: 'PIX CRED A VISTA',
            isCreditCardInvoice: true,
            creditCardId: 'card-1',
        })

        const result = await sut.handle(tx)

        expect(result.type).toBe('EXPENSE')
        expect(result.paymentMethod).toBe('CREDIT_CARD')
    })

    it('força type=EXPENSE para "JUROS PIX CREDITO" em importação', async () => {
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'DEPOSIT',
            category: 'OTHER',
            paymentMethod: 'PIX',
            categoryId: undefined,
            categoryName: undefined,
        })

        const tx = makeTx({
            name: 'JUROS PIX CREDITO',
            isCreditCardInvoice: true,
        })

        const result = await sut.handle(tx)

        expect(result.type).toBe('EXPENSE')
        expect(result.paymentMethod).toBe('CREDIT_CARD')
    })

    it('força type=EXPENSE para "SEGURO CARTAO CTP" em importação', async () => {
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'DEPOSIT',
            category: 'OTHER',
            paymentMethod: 'OTHER',
            categoryId: undefined,
            categoryName: undefined,
        })

        const tx = makeTx({
            name: 'SEGURO CARTAO CTP',
            isCreditCardInvoice: true,
        })

        const result = await sut.handle(tx)

        expect(result.type).toBe('EXPENSE')
        expect(result.paymentMethod).toBe('CREDIT_CARD')
    })

    it('força paymentMethod=CREDIT_CARD em importação mesmo que Gemini diga PIX', async () => {
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'EXPENSE',
            category: 'TRANSPORTATION',
            paymentMethod: 'PIX',      // Gemini errou o método
            categoryId: undefined,
            categoryName: 'Transporte',
        })

        const tx = makeTx({
            name: 'RECARGAPAY CARTAOGV SAO PAULO BRA',
            isCreditCardInvoice: true,
        })

        const result = await sut.handle(tx)

        expect(result.paymentMethod).toBe('CREDIT_CARD')
    })

    it('NÃO força type quando isCreditCardInvoice=false — respeita decisão do Gemini', async () => {
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'DEPOSIT',
            category: 'OTHER',
            paymentMethod: 'PIX',
            categoryId: undefined,
            categoryName: undefined,
        })

        const tx = makeTx({
            name: 'TRANSFERENCIA RECEBIDA',
            isCreditCardInvoice: false,
        })

        const result = await sut.handle(tx)

        expect(result.type).toBe('DEPOSIT')
        expect(result.paymentMethod).toBe('PIX')
    })

    it('ainda classifica category corretamente em importação de fatura', async () => {
        mocks.detectTransactionDataWithIA.mockResolvedValue({
            type: 'DEPOSIT',   // vai ser ignorado
            category: 'FOOD',
            paymentMethod: 'PIX',   // vai ser ignorado
            categoryId: 'cat-123',
            categoryName: 'Supermercado',
        })

        const tx = makeTx({
            name: 'EasyMarket VILA VELHA BRA',
            isCreditCardInvoice: true,
        })

        const result = await sut.handle(tx)

        expect(result.type).toBe('EXPENSE')
        expect(result.category).toBe('FOOD')
        expect(result.categoryId).toBe('cat-123')
    })


    it('não chama Gemini quando transaction.name está ausente', async () => {
        const tx = makeTx({ name: undefined })
        await sut.handle(tx)
        expect(mocks.detectTransactionDataWithIA).not.toHaveBeenCalled()
    })
})
