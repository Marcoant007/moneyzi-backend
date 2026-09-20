import { describe, it, expect, vi } from 'vitest'
import { ListCategoriesUseCase } from '../category-use-case/list-categories.use-case'
import { CategoryRepository } from '@/application/repositories/category-repository'
import { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Category } from '@prisma/client'

function makeCategory(overrides: Partial<Category>): Category {
    return {
        id: 'id',
        name: 'name',
        userId: 'user-1',
        parentId: null,
        color: null,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }
}

function makeRepositories(categories: Category[], spendByCategoryId: Record<string, number>) {
    const categoryRepository = {
        listByUserId: vi.fn().mockResolvedValue(categories),
        countTransactionsByCategoryId: vi.fn().mockResolvedValue(new Map()),
        countLinkedTransactionsByCategoryId: vi.fn().mockResolvedValue(new Map()),
    } as unknown as CategoryRepository

    const transactionRepository = {
        groupExpensesByCategoryId: vi.fn().mockResolvedValue(
            Object.entries(spendByCategoryId).map(([categoryId, amount]) => ({
                categoryId,
                category: 'OTHER',
                _sum: { amount },
            })),
        ),
    } as unknown as TransactionRepository

    return { categoryRepository, transactionRepository }
}

describe('ListCategoriesUseCase', () => {
    it('returns flat totals unchanged when there is no hierarchy', async () => {
        const { categoryRepository, transactionRepository } = makeRepositories(
            [makeCategory({ id: 'cat-1', name: 'Transporte' })],
            { 'cat-1': 150 },
        )
        const sut = new ListCategoriesUseCase(categoryRepository, transactionRepository)

        const result = await sut.execute('user-1')

        expect(result).toEqual([
            {
                id: 'cat-1',
                name: 'Transporte',
                parentId: null,
                color: null,
                icon: null,
                createdAt: expect.any(Date),
                totalSpend: 150,
                transactionCount: 0,
                linkedTransactionCount: 0,
            },
        ])
    })

    it('rolls up 3-level totals: Alimentação -> Supermercado -> iFood (100/200/300 -> 600/500/300)', async () => {
        const { categoryRepository, transactionRepository } = makeRepositories(
            [
                makeCategory({ id: 'alimentacao', name: 'Alimentação', parentId: null }),
                makeCategory({ id: 'supermercado', name: 'Supermercado', parentId: 'alimentacao' }),
                makeCategory({ id: 'ifood', name: 'iFood', parentId: 'supermercado' }),
            ],
            { alimentacao: 100, supermercado: 200, ifood: 300 },
        )
        const sut = new ListCategoriesUseCase(categoryRepository, transactionRepository)

        const result = await sut.execute('user-1')
        const byId = new Map(result.map((c) => [c.id, c.totalSpend]))

        expect(byId.get('alimentacao')).toBe(600)
        expect(byId.get('supermercado')).toBe(500)
        expect(byId.get('ifood')).toBe(300)
    })

    it('exposes color/icon and a linked count that includes soft-deleted transactions', async () => {
        const categories = [
            makeCategory({ id: 'cat-1', name: 'Pet', color: 'sky', icon: 'paw-print' }),
            makeCategory({ id: 'cat-2', name: 'Só na lixeira' }),
        ]
        const { categoryRepository, transactionRepository } = makeRepositories(categories, {})
        vi.mocked(categoryRepository.countTransactionsByCategoryId).mockResolvedValue(new Map([['cat-1', 2]]))
        // cat-2 só tem transação soft-deleted: o count "visível" é 0, o vinculado é 1
        vi.mocked(categoryRepository.countLinkedTransactionsByCategoryId).mockResolvedValue(
            new Map([
                ['cat-1', 3],
                ['cat-2', 1],
            ]),
        )
        const sut = new ListCategoriesUseCase(categoryRepository, transactionRepository)

        const result = await sut.execute('user-1')
        const byId = new Map(result.map((c) => [c.id, c]))

        expect(byId.get('cat-1')).toMatchObject({ color: 'sky', icon: 'paw-print', transactionCount: 2, linkedTransactionCount: 3 })
        expect(byId.get('cat-2')).toMatchObject({ color: null, icon: null, transactionCount: 0, linkedTransactionCount: 1 })
    })
})
