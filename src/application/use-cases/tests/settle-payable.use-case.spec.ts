import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettlePayableUseCase } from '../payables-use-case/settle-payable.use-case'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'

const mocks = vi.hoisted(() => ({
    findCard: vi.fn(),
    findTransactions: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        creditCard: {
            findUnique: mocks.findCard,
        },
        transaction: {
            findMany: mocks.findTransactions,
        },
    },
}))

describe('SettlePayableUseCase', () => {
    let transactionRepository: TransactionRepository
    let sut: SettlePayableUseCase

    beforeEach(() => {
        vi.clearAllMocks()

        transactionRepository = {
            markAsPaid: vi.fn(),
            markAsPending: vi.fn(),
        } as unknown as TransactionRepository

        sut = new SettlePayableUseCase(transactionRepository)
    })

    it('should settle a single transaction as paid', async () => {
        const result = await sut.execute({
            mode: 'PAY',
            scope: 'TRANSACTION',
            transactionId: 'tx-1',
        })

        expect(transactionRepository.markAsPaid).toHaveBeenCalledWith(['tx-1'])
        expect(transactionRepository.markAsPending).not.toHaveBeenCalled()
        expect(result).toEqual({ updatedCount: 1 })
    })

    it('should settle a single transaction as pending when mode is UNPAY', async () => {
        const result = await sut.execute({
            mode: 'UNPAY',
            scope: 'TRANSACTION',
            transactionId: 'tx-1',
        })

        expect(transactionRepository.markAsPending).toHaveBeenCalledWith(['tx-1'])
        expect(transactionRepository.markAsPaid).not.toHaveBeenCalled()
        expect(result).toEqual({ updatedCount: 1 })
    })

    it('should fail when TRANSACTION scope has no transactionId', async () => {
        await expect(
            sut.execute({
                mode: 'PAY',
                scope: 'TRANSACTION',
            }),
        ).rejects.toThrow('transactionId is required for TRANSACTION scope')
    })

    it('should fail when CARD_STATEMENT scope has no card payload', async () => {
        await expect(
            sut.execute({
                mode: 'PAY',
                scope: 'CARD_STATEMENT',
            }),
        ).rejects.toThrow('card is required for CARD_STATEMENT scope')
    })

    it('should settle card statement transactions including fallback due date by closing day', async () => {
        mocks.findCard.mockResolvedValue({ dueDay: 10, closingDay: 5 })
        mocks.findTransactions.mockResolvedValue([
            {
                id: 'tx-with-due-date',
                date: new Date(2026, 1, 1),
                dueDate: new Date(2026, 2, 10),
            },
            {
                id: 'tx-fallback-in-month',
                date: new Date(2026, 1, 6),
                dueDate: null,
            },
            {
                id: 'tx-fallback-out-month',
                date: new Date(2026, 1, 4),
                dueDate: null,
            },
        ])

        const result = await sut.execute({
            mode: 'PAY',
            scope: 'CARD_STATEMENT',
            card: {
                creditCardId: 'card-1',
                dueDate: '2026-03-10T00:00:00.000Z',
            },
        })

        expect(transactionRepository.markAsPaid).toHaveBeenCalledWith([
            'tx-with-due-date',
            'tx-fallback-in-month',
        ])
        expect(result).toEqual({ updatedCount: 2 })
    })

    it('should fail when no transaction can be resolved for settlement', async () => {
        mocks.findCard.mockResolvedValue({ dueDay: null, closingDay: null })
        mocks.findTransactions.mockResolvedValue([
            {
                id: 'tx-1',
                date: new Date(2026, 1, 6),
                dueDate: null,
            },
        ])

        await expect(
            sut.execute({
                mode: 'PAY',
                scope: 'CARD_STATEMENT',
                card: {
                    creditCardId: 'card-1',
                    dueDate: '2026-03-10T00:00:00.000Z',
                },
            }),
        ).rejects.toThrow('No transactions found to settle')
    })
})
