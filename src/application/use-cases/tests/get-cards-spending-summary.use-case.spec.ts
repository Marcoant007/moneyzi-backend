import { describe, it, expect, vi } from 'vitest'
import { GetCardsSpendingSummaryUseCase } from '../credit-card-use-case/get-cards-spending-summary.use-case'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CreditCardRepository } from '@/core/repositories/credit-card-repository'

type Candidate = {
    id: string
    creditCardId: string | null
    type: 'EXPENSE' | 'DEPOSIT' | 'INVESTMENT'
    amount: number
    date: Date
    dueDate: Date | null
}

const nubank = {
    id: 'card-nu',
    name: 'Nubank',
    lastFourDigits: '1234',
    brand: 'VISA',
    color: '#8a05be',
    limit: 10000,
    closingDay: 3,
    dueDay: 10,
}
const inter = {
    id: 'card-inter',
    name: 'Inter',
    lastFourDigits: '9999',
    brand: 'MASTERCARD',
    color: '#ff7a00',
    limit: null,
    closingDay: undefined,
    dueDay: undefined,
}

function makeSut(candidates: Candidate[], cards: unknown[] = [nubank, inter]) {
    const findCardInvoiceCandidates = vi.fn().mockResolvedValue(candidates)
    const transactionRepository = { findCardInvoiceCandidates } as unknown as TransactionRepository
    const creditCardRepository = {
        findActiveByUserId: vi.fn().mockResolvedValue(cards),
    } as unknown as CreditCardRepository
    return {
        sut: new GetCardsSpendingSummaryUseCase(creditCardRepository, transactionRepository),
        findCardInvoiceCandidates,
    }
}

const tx = (overrides: Partial<Candidate>): Candidate => ({
    id: Math.random().toString(36).slice(2),
    creditCardId: nubank.id,
    type: 'EXPENSE',
    amount: 100,
    date: new Date(2026, 9, 15, 12),
    dueDate: new Date(2026, 10, 10, 12),
    ...overrides,
})

describe('GetCardsSpendingSummaryUseCase', () => {
    it('attributes purchases to the invoice (dueDate) month, not the purchase month', async () => {
        const { sut } = makeSut([
            // compra em outubro, fatura de novembro → conta em novembro
            tx({ amount: 300, date: new Date(2026, 9, 20, 12), dueDate: new Date(2026, 10, 10, 12) }),
            // compra em novembro, fatura de dezembro → o repo traria só se o filtro falhasse; não conta
            tx({ amount: 999, date: new Date(2026, 10, 5, 12), dueDate: new Date(2026, 11, 10, 12) }),
        ])

        const result = await sut.execute('user-1', 11, 2026)
        const nu = result.find((c) => c.cardId === nubank.id)!

        expect(nu.totalSpent).toBe(300)
        expect(nu.transactionCount).toBe(1)
        expect(nu.percentageUsed).toBeCloseTo(3)
    })

    it('queries all cards at once for the requested month range', async () => {
        const { sut, findCardInvoiceCandidates } = makeSut([])
        await sut.execute('user-1', 11, 2026)

        expect(findCardInvoiceCandidates).toHaveBeenCalledTimes(1)
        const [ids, start, end] = findCardInvoiceCandidates.mock.calls[0]
        expect(ids).toEqual([nubank.id, inter.id])
        expect(start).toEqual(new Date(2026, 10, 1))
        expect(end).toEqual(new Date(2026, 11, 1))
    })

    it('resolves the invoice from closing/due day when dueDate is missing', async () => {
        const { sut } = makeSut([
            // dia 2 ≤ fechamento 3 → fatura do mês seguinte (novembro)
            tx({ amount: 50, date: new Date(2026, 9, 2, 12), dueDate: null }),
            // dia 20 > fechamento 3 → fatura de dezembro, fora de novembro
            tx({ amount: 70, date: new Date(2026, 9, 20, 12), dueDate: null }),
        ])

        const result = await sut.execute('user-1', 11, 2026)
        expect(result.find((c) => c.cardId === nubank.id)!.totalSpent).toBe(50)
    })

    it('falls back to the purchase month when the card has no due day', async () => {
        const { sut } = makeSut([
            tx({ creditCardId: inter.id, amount: 40, date: new Date(2026, 10, 3, 12), dueDate: null }),
            tx({ creditCardId: inter.id, amount: 60, date: new Date(2026, 9, 28, 12), dueDate: null }),
        ])

        const result = await sut.execute('user-1', 11, 2026)
        const card = result.find((c) => c.cardId === inter.id)!
        expect(card.totalSpent).toBe(40)
        expect(card.percentageUsed).toBeNull()
    })

    it('subtracts refunds and ignores non-spending types', async () => {
        const { sut } = makeSut([
            tx({ amount: 500 }),
            tx({ type: 'DEPOSIT', amount: 120 }),
            tx({ type: 'INVESTMENT', amount: 1000 }),
        ])

        const result = await sut.execute('user-1', 11, 2026)
        const nu = result.find((c) => c.cardId === nubank.id)!
        expect(nu.totalSpent).toBe(380)
        expect(nu.transactionCount).toBe(2)
    })

    it('returns every active card, sorted by spend, including zeroed ones', async () => {
        const { sut } = makeSut([
            tx({ creditCardId: inter.id, amount: 900, dueDate: new Date(2026, 10, 15, 12) }),
            tx({ amount: 100 }),
        ])

        const result = await sut.execute('user-1', 11, 2026)
        expect(result.map((c) => c.cardId)).toEqual([inter.id, nubank.id])

        const empty = await makeSut([]).sut.execute('user-1', 11, 2026)
        expect(empty).toHaveLength(2)
        expect(empty.every((c) => c.totalSpent === 0)).toBe(true)
    })

    it('returns an empty list when the user has no active cards', async () => {
        const { sut, findCardInvoiceCandidates } = makeSut([], [])
        expect(await sut.execute('user-1', 11, 2026)).toEqual([])
        expect(findCardInvoiceCandidates).not.toHaveBeenCalled()
    })
})
