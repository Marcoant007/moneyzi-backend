import { describe, it, expect, vi, beforeEach } from 'vitest'

const { globalClient } = vi.hoisted(() => ({
    globalClient: {
        transaction: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
        category: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    },
}))

vi.mock('@/lib/prisma', () => ({ prisma: globalClient }))

import { PrismaCategoryRepository } from '../prisma-category-repository'

function fakeClient() {
    return {
        transaction: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn(), groupBy: vi.fn() },
        category: {
            findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            count: vi.fn(), delete: vi.fn(), findFirst: vi.fn(),
        },
    }
}

describe('PrismaCategoryRepository — reorganization methods', () => {
    beforeEach(() => vi.clearAllMocks())

    it('uses the injected (transaction) client for everything and never falls back to the global one', async () => {
        const client = fakeClient()
        const repository = new PrismaCategoryRepository(client as any)

        await repository.listByUserId('user-1')
        await repository.listTransactionRefs('user-1', 'cat-1')
        await repository.moveTransactionsToCategory('user-1', 'a', 'b')
        await repository.deleteForUser('user-1', 'cat-1')

        expect(client.category.findMany).toHaveBeenCalled()
        expect(client.transaction.findMany).toHaveBeenCalled()
        expect(globalClient.category.findMany).not.toHaveBeenCalled()
        expect(globalClient.transaction.findMany).not.toHaveBeenCalled()
        expect(globalClient.transaction.updateMany).not.toHaveBeenCalled()
        expect(globalClient.category.deleteMany).not.toHaveBeenCalled()
    })

    it('keeps working with no argument, on the global client (existing call sites are unchanged)', async () => {
        globalClient.category.findMany.mockResolvedValue([])

        await new PrismaCategoryRepository().listByUserId('user-1')

        expect(globalClient.category.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' }, orderBy: { name: 'asc' } })
    })

    it('listTransactionRefs does NOT filter soft-deleted rows (the FK would null them on delete) and flags them', async () => {
        const client = fakeClient()
        client.transaction.findMany.mockResolvedValue([
            { id: 'tx-1', deletedAt: null },
            { id: 'tx-2', deletedAt: new Date('2026-02-01') },
        ])

        const refs = await new PrismaCategoryRepository(client as any).listTransactionRefs('user-1', 'cat-1')

        expect(client.transaction.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', categoryId: 'cat-1' }, select: { id: true, deletedAt: true } })
        expect(refs).toEqual([{ id: 'tx-1', deleted: false }, { id: 'tx-2', deleted: true }])
    })

    it('moveTransactionsToCategory changes ONLY categoryId, scoped by user', async () => {
        const client = fakeClient()
        client.transaction.updateMany.mockResolvedValue({ count: 7 })

        const count = await new PrismaCategoryRepository(client as any).moveTransactionsToCategory('user-1', 'from', 'to')

        expect(client.transaction.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', categoryId: 'from' }, data: { categoryId: 'to' } })
        expect(count).toBe(7)
    })

    it('assignTransactionsToCategory is scoped by user and split into chunks for very large id lists', async () => {
        const client = fakeClient()
        client.transaction.updateMany.mockResolvedValue({ count: 5000 })
        const ids = Array.from({ length: 12000 }, (_, i) => `tx-${i}`)

        const count = await new PrismaCategoryRepository(client as any).assignTransactionsToCategory('user-1', ids, 'cat-1')

        expect(client.transaction.updateMany).toHaveBeenCalledTimes(3)
        for (const call of client.transaction.updateMany.mock.calls) {
            expect(call[0].where.userId).toBe('user-1')
            expect(call[0].data).toEqual({ categoryId: 'cat-1' })
            expect(call[0].where.id.in.length).toBeLessThanOrEqual(5000)
        }
        expect(count).toBe(15000)
    })

    it('findTransactionCategoryIds is scoped by user and chunked', async () => {
        const client = fakeClient()
        client.transaction.findMany.mockResolvedValue([{ id: 'tx-1', categoryId: 'cat-1' }])

        const rows = await new PrismaCategoryRepository(client as any).findTransactionCategoryIds('user-1', ['tx-1'])

        expect(client.transaction.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', id: { in: ['tx-1'] } }, select: { id: true, categoryId: true } })
        expect(rows).toEqual([{ id: 'tx-1', categoryId: 'cat-1' }])
    })

    it('reparentCategories is scoped by user, accepts a null parent, and does nothing for an empty list', async () => {
        const client = fakeClient()
        client.category.updateMany.mockResolvedValue({ count: 2 })
        const repository = new PrismaCategoryRepository(client as any)

        expect(await repository.reparentCategories('user-1', [], 'p')).toBe(0)
        expect(client.category.updateMany).not.toHaveBeenCalled()

        await repository.reparentCategories('user-1', ['a', 'b'], null)
        expect(client.category.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', id: { in: ['a', 'b'] } }, data: { parentId: null } })
    })

    it('restore recreates the category with the ORIGINAL id and createdAt', async () => {
        const client = fakeClient()
        const createdAt = new Date('2026-01-15T08:00:00.000Z')

        await new PrismaCategoryRepository(client as any).restore({ id: 'cat-1', userId: 'user-1', name: 'Aluguel Base ', parentId: 'p', createdAt })

        expect(client.category.create).toHaveBeenCalledWith({
            data: { id: 'cat-1', userId: 'user-1', name: 'Aluguel Base ', parentId: 'p', createdAt, color: null, icon: null },
        })
    })

    it('restore also brings back the color and icon the category had', async () => {
        const client = fakeClient()
        const createdAt = new Date('2026-01-15T08:00:00.000Z')

        await new PrismaCategoryRepository(client as any).restore({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Pet',
            parentId: null,
            createdAt,
            color: 'sky',
            icon: 'paw-print',
        })

        expect(client.category.create).toHaveBeenCalledWith({
            data: { id: 'cat-1', userId: 'user-1', name: 'Pet', parentId: null, createdAt, color: 'sky', icon: 'paw-print' },
        })
    })

    it('deleteForUser deletes only when the category belongs to the user and reports whether it did', async () => {
        const client = fakeClient()
        const repository = new PrismaCategoryRepository(client as any)

        client.category.deleteMany.mockResolvedValueOnce({ count: 1 })
        expect(await repository.deleteForUser('user-1', 'cat-1')).toBe(true)
        expect(client.category.deleteMany).toHaveBeenCalledWith({ where: { id: 'cat-1', userId: 'user-1' } })

        client.category.deleteMany.mockResolvedValueOnce({ count: 0 })
        expect(await repository.deleteForUser('user-2', 'cat-1')).toBe(false)
    })
})
