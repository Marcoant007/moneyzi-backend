import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findMany, groupBy } = vi.hoisted(() => ({
    findMany: vi.fn(),
    groupBy: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
    prisma: { transaction: { findMany, groupBy } },
}))

import { PrismaTransactionRepository } from '../prisma-transaction-repository'

function lastWhere() {
    return findMany.mock.calls[findMany.mock.calls.length - 1][0].where
}

describe('PrismaTransactionRepository.findManyByFilter (MCP bulk filter)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        findMany.mockResolvedValue([])
    })

    const repository = new PrismaTransactionRepository()

    it('always scopes by user and excludes soft-deleted transactions, newest first, capped by the limit', async () => {
        await repository.findManyByFilter('user-1', {}, 500)

        expect(findMany.mock.calls[0][0]).toMatchObject({
            where: { userId: 'user-1', deletedAt: null },
            orderBy: { date: 'desc' },
            take: 500,
        })
    })

    it('keeps the old fields exactly as before (regression): nameContains, currentCategoryId and the date range', async () => {
        const dateFrom = new Date('2026-03-01')
        const dateTo = new Date('2026-03-31')

        await repository.findManyByFilter('user-1', { nameContains: 'uber', currentCategoryId: 'cat-9', dateFrom, dateTo }, 500)

        expect(lastWhere()).toEqual({
            userId: 'user-1',
            deletedAt: null,
            name: { contains: 'uber', mode: 'insensitive' },
            categoryId: 'cat-9',
            date: { gte: dateFrom, lte: dateTo },
        })
    })

    it('nameContainsAny is an OR between the terms, case-insensitive', async () => {
        await repository.findManyByFilter('user-1', { nameContainsAny: ['iptu', 'Seguro'] }, 500)

        expect(lastWhere().AND).toEqual([
            {
                OR: [
                    { name: { contains: 'iptu', mode: 'insensitive' } },
                    { name: { contains: 'Seguro', mode: 'insensitive' } },
                ],
            },
        ])
    })

    it('combines nameContains AND nameContainsAny with the other fields (AND across different fields)', async () => {
        await repository.findManyByFilter(
            'user-1',
            { nameContains: 'ref', nameContainsAny: ['iptu', 'seguro'], paymentMethod: 'BANK_SLIP', type: 'EXPENSE' },
            500,
        )

        expect(lastWhere()).toMatchObject({
            userId: 'user-1',
            name: { contains: 'ref', mode: 'insensitive' },
            AND: [{ OR: expect.any(Array) }],
            paymentMethod: 'BANK_SLIP',
            type: 'EXPENSE',
        })
    })

    it('ignores an empty nameContainsAny instead of matching nothing', async () => {
        await repository.findManyByFilter('user-1', { nameContainsAny: [] }, 500)

        expect(lastWhere()).not.toHaveProperty('AND')
    })

    it('applies paymentMethod, type and an inclusive amount range', async () => {
        await repository.findManyByFilter('user-1', { paymentMethod: 'PIX', type: 'DEPOSIT', amountMin: 10, amountMax: 99.9 }, 500)

        expect(lastWhere()).toMatchObject({ paymentMethod: 'PIX', type: 'DEPOSIT', amount: { gte: 10, lte: 99.9 } })
    })

    it('supports one-sided amount ranges and a minimum of exactly 0', async () => {
        await repository.findManyByFilter('user-1', { amountMin: 0 }, 500)
        expect(lastWhere().amount).toEqual({ gte: 0 })

        await repository.findManyByFilter('user-1', { amountMax: 50 }, 500)
        expect(lastWhere().amount).toEqual({ lte: 50 })
    })

    it('filters a system category as "no custom category + this enum" — a custom category with enum OTHER is NOT "OTHER"', async () => {
        await repository.findManyByFilter('user-1', { currentSystemCategory: 'OTHER' }, 500)

        expect(lastWhere()).toMatchObject({ categoryId: null, category: 'OTHER' })
    })

    it('selects the category name and maps rows to snapshots (custom name, else the system enum; Decimal -> number)', async () => {
        findMany.mockResolvedValue([
            { id: 'tx-1', name: 'Iptu', amount: { toString: () => '120.50', valueOf: () => 120.5 }, date: new Date('2026-03-05'), categoryId: 'cat-1', category: 'OTHER', categoryRef: { name: 'Impostos' } },
            { id: 'tx-2', name: 'Faxina', amount: 200, date: new Date('2026-03-06'), categoryId: null, category: 'SERVICES', categoryRef: null },
        ])

        const result = await repository.findManyByFilter('user-1', {}, 500)

        expect(findMany.mock.calls[0][0].select.categoryRef).toEqual({ select: { name: true } })
        expect(result).toEqual([
            { id: 'tx-1', name: 'Iptu', amount: 120.5, date: new Date('2026-03-05'), categoryId: 'cat-1', category: 'OTHER', categoryName: 'Impostos' },
            { id: 'tx-2', name: 'Faxina', amount: 200, date: new Date('2026-03-06'), categoryId: null, category: 'SERVICES', categoryName: 'SERVICES' },
        ])
    })

    it('findManyByIdsWithCategory stays scoped by user and excludes soft-deleted, with the same snapshot shape', async () => {
        findMany.mockResolvedValue([
            { id: 'tx-1', name: 'A', amount: 5, date: new Date('2026-03-05'), categoryId: null, category: 'FOOD', categoryRef: null },
        ])

        const result = await repository.findManyByIdsWithCategory(['tx-1', 'tx-2'], 'user-1')

        expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: ['tx-1', 'tx-2'] }, userId: 'user-1', deletedAt: null })
        expect(result[0]).toMatchObject({ id: 'tx-1', categoryName: 'FOOD' })
    })
})

describe('PrismaTransactionRepository.countBySystemCategory', () => {
    beforeEach(() => vi.clearAllMocks())

    it('counts only active transactions with no custom category, grouped by the enum', async () => {
        groupBy.mockResolvedValue([
            { category: 'SERVICES', _count: { _all: 4 } },
            { category: 'OTHER', _count: { _all: 9 } },
        ])

        const counts = await new PrismaTransactionRepository().countBySystemCategory('user-1')

        expect(groupBy).toHaveBeenCalledWith({
            by: ['category'],
            where: { userId: 'user-1', categoryId: null, deletedAt: null },
            _count: { _all: true },
        })
        expect(counts.get('SERVICES')).toBe(4)
        expect(counts.get('OTHER')).toBe(9)
        expect(counts.get('HOUSING')).toBeUndefined()
    })
})
