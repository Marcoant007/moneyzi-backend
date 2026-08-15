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
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }
}

function makeRepositories(categories: Category[], spendByCategoryId: Record<string, number>) {
    const categoryRepository = {
        listByUserId: vi.fn().mockResolvedValue(categories),
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
            { id: 'cat-1', name: 'Transporte', parentId: null, createdAt: expect.any(Date), totalSpend: 150 },
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
})
