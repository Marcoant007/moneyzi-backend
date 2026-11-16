import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
    transaction: {
        updateMany: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
    },
    category: { count: vi.fn() },
    account: { count: vi.fn() },
    creditCard: { count: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'

const base = {
    userId: 'attacker',
    name: 'Mercado',
    amount: 10,
    type: 'EXPENSE',
    category: 'FOOD',
    paymentMethod: 'PIX',
    date: new Date('2026-11-16'),
} as any

describe('PrismaTransactionRepository.upsert ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        db.category.count.mockResolvedValue(1)
        db.account.count.mockResolvedValue(1)
        db.creditCard.count.mockResolvedValue(1)
    })

    it('updates only a transaction owned by the caller (never a cross-user upsert)', async () => {
        db.transaction.updateMany.mockResolvedValue({ count: 1 })

        await new PrismaTransactionRepository().upsert({ ...base, id: 'tx-1' })

        expect(db.transaction.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'tx-1', userId: 'attacker' } }),
        )
        // userId nunca é regravado no update (antes a transação mudava de dono).
        expect(db.transaction.updateMany.mock.calls[0][0].data).not.toHaveProperty('userId')
        expect(db.transaction.upsert).not.toHaveBeenCalled()
        expect(db.transaction.create).not.toHaveBeenCalled()
    })

    it("rejects updating someone else's transaction", async () => {
        db.transaction.updateMany.mockResolvedValue({ count: 0 })

        await expect(
            new PrismaTransactionRepository().upsert({ ...base, id: 'victim-tx' }),
        ).rejects.toThrow('TRANSACTION_NOT_FOUND')
        expect(db.transaction.create).not.toHaveBeenCalled()
    })

    it("rejects pointing a transaction at another user's credit card", async () => {
        db.creditCard.count.mockResolvedValue(0)

        await expect(
            new PrismaTransactionRepository().upsert({ ...base, creditCardId: 'victim-card' }),
        ).rejects.toThrow('INVALID_REFERENCE')
        expect(db.creditCard.count).toHaveBeenCalledWith({ where: { id: 'victim-card', userId: 'attacker' } })
        expect(db.transaction.create).not.toHaveBeenCalled()
    })

    it("rejects bulk recategorizing into another user's category", async () => {
        db.category.count.mockResolvedValue(0)

        await expect(
            new PrismaTransactionRepository().updateManyCategory(['tx-1'], 'attacker', { categoryId: 'victim-cat' }),
        ).rejects.toThrow('INVALID_REFERENCE')
        expect(db.transaction.updateMany).not.toHaveBeenCalled()
    })

    it('creates without a client-chosen id when no id is given', async () => {
        await new PrismaTransactionRepository().upsert({ ...base, categoryId: 'own-cat' })

        expect(db.transaction.create).toHaveBeenCalledTimes(1)
        expect(db.transaction.create.mock.calls[0][0].data).not.toHaveProperty('id')
        expect(db.transaction.create.mock.calls[0][0].data.userId).toBe('attacker')
    })
})
