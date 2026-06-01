import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettlePayableUseCase } from '../payables-use-case/settle-payable.use-case'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'

const mocks = vi.hoisted(() => ({
    findCard: vi.fn(),
    findTransactions: vi.fn(),
    findFirstTransaction: vi.fn(),
    createTransaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        creditCard: {
            findUnique: mocks.findCard,
        },
        transaction: {
            findMany: mocks.findTransactions,
            findFirst: mocks.findFirstTransaction,
            create: mocks.createTransaction,
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
            findRecurringNextOccurrence: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
        } as unknown as TransactionRepository

        sut = new SettlePayableUseCase(transactionRepository)
    })

    it('should settle a single non-recurring transaction as paid', async () => {
        mocks.findFirstTransaction
            .mockResolvedValueOnce({ id: 'tx-1' })           // resolveIds
            .mockResolvedValueOnce({ id: 'tx-1', isRecurring: false }) // maybeCreateNextOccurrence

        const result = await sut.execute({
            userId: 'user-1',
            mode: 'PAY',
            scope: 'TRANSACTION',
            transactionId: 'tx-1',
        })

        expect(transactionRepository.markAsPaid).toHaveBeenCalledWith(['tx-1'])
        expect(transactionRepository.markAsPending).not.toHaveBeenCalled()
        expect(transactionRepository.create).not.toHaveBeenCalled()
        expect(result).toEqual({ updatedCount: 1 })
    })

    it('should auto-create next month occurrence when paying a recurring transaction', async () => {
        const dueDate = new Date(2026, 4, 8, 12, 0, 0, 0) // May 8 2026

        mocks.findFirstTransaction
            .mockResolvedValueOnce({ id: 'tx-1' }) // resolveIds
            .mockResolvedValueOnce({               // maybeCreateNextOccurrence
                id: 'tx-1',
                userId: 'user-1',
                name: 'Aluguel',
                description: null,
                type: 'EXPENSE',
                amount: '2899.54',
                category: 'HOUSING',
                paymentMethod: 'BANK_TRANSFER',
                date: dueDate,
                dueDate,
                isRecurring: true,
                recurrenceGroupId: null,
                categoryId: null,
                accountId: null,
            })

        const result = await sut.execute({
            userId: 'user-1',
            mode: 'PAY',
            scope: 'TRANSACTION',
            transactionId: 'tx-1',
        })

        expect(transactionRepository.markAsPaid).toHaveBeenCalledWith(['tx-1'])
        expect(transactionRepository.findRecurringNextOccurrence).toHaveBeenCalledWith(
            'user-1',
            'Aluguel',
            6,    // June
            2026,
        )
        expect(transactionRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                name: 'Aluguel',
                isRecurring: true,
                paymentStatus: 'PENDING',
                paidAt: null,
                dueDate: new Date(2026, 5, 8, 12, 0, 0, 0), // June 8 2026
            }),
        )
        expect(result).toEqual({ updatedCount: 1 })
    })

    it('should not create next occurrence if one already exists', async () => {
        const dueDate = new Date(2026, 4, 8, 12, 0, 0, 0)

        mocks.findFirstTransaction
            .mockResolvedValueOnce({ id: 'tx-1' })
            .mockResolvedValueOnce({
                id: 'tx-1',
                userId: 'user-1',
                name: 'Aluguel',
                description: null,
                type: 'EXPENSE',
                amount: '2899.54',
                category: 'HOUSING',
                paymentMethod: 'BANK_TRANSFER',
                date: dueDate,
                dueDate,
                isRecurring: true,
                recurrenceGroupId: null,
                categoryId: null,
                accountId: null,
            })

        ;(transactionRepository.findRecurringNextOccurrence as ReturnType<typeof vi.fn>)
            .mockResolvedValue({ id: 'tx-already-exists' })

        await sut.execute({
            userId: 'user-1',
            mode: 'PAY',
            scope: 'TRANSACTION',
            transactionId: 'tx-1',
        })

        expect(transactionRepository.create).not.toHaveBeenCalled()
    })

    it('should settle a single transaction as pending when mode is UNPAY', async () => {
        mocks.findFirstTransaction.mockResolvedValueOnce({ id: 'tx-1' })

        const result = await sut.execute({
            userId: 'user-1',
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
                userId: 'user-1',
                mode: 'PAY',
                scope: 'TRANSACTION',
            }),
        ).rejects.toThrow('transactionId is required for TRANSACTION scope')
    })

    it('should fail when CARD_STATEMENT scope has no card payload', async () => {
        await expect(
            sut.execute({
                userId: 'user-1',
                mode: 'PAY',
                scope: 'CARD_STATEMENT',
            }),
        ).rejects.toThrow('card is required for CARD_STATEMENT scope')
    })

    it('should settle card statement transactions including entries from two months back', async () => {
        mocks.findCard.mockResolvedValue({ dueDay: 10, closingDay: 5 })
        mocks.findTransactions.mockResolvedValue([
            {
                id: 'tx-with-due-date',
                date: new Date(2026, 1, 1),
                dueDate: new Date(2026, 2, 10),
            },
            {
                id: 'tx-fallback-before',
                date: new Date(2026, 1, 4), // Feb 4 <= closingDay 5 -> Mar
                dueDate: null,
            },
            {
                id: 'tx-fallback-after',
                date: new Date(2026, 1, 6), // Feb 6 > closingDay 5 -> Apr
                dueDate: null,
            },
            {
                id: 'tx-fallback-jan-after',
                date: new Date(2026, 0, 20), // Jan 20 > closingDay 5 -> Mar (+2)
                dueDate: null,
            },
        ])

        const result = await sut.execute({
            userId: 'user-1',
            mode: 'PAY',
            scope: 'CARD_STATEMENT',
            card: {
                creditCardId: 'card-1',
                dueDate: '2026-03-10T00:00:00.000Z',
            },
        })

        expect(mocks.findTransactions).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    userId: 'user-1',
                    creditCardId: 'card-1',
                }),
            }),
        )
        expect(transactionRepository.markAsPaid).toHaveBeenCalledWith([
            'tx-with-due-date',
            'tx-fallback-before',
            'tx-fallback-jan-after',
        ])
        expect(result).toEqual({ updatedCount: 3 })
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
                userId: 'user-1',
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
