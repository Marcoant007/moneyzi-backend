import { describe, it, expect, vi } from 'vitest'
import { ListCategoriesWithTransactionsUseCase } from '../category-use-case/list-categories-with-transactions.use-case'
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

function makeTransaction(id: string, amount: number) {
    return { id, name: `tx-${id}`, amount, date: new Date(), paymentMethod: 'PIX' }
}

function makeRepositories(categories: Category[], transactionsByCategoryId: Record<string, ReturnType<typeof makeTransaction>[]>) {
    const categoryRepository = {
        listByUserId: vi.fn().mockResolvedValue(categories),
    } as unknown as CategoryRepository

    const transactionRepository = {
        findByCategory: vi.fn().mockImplementation(async (categoryId: string) => transactionsByCategoryId[categoryId] ?? []),
        // Chamado uma vez por cada uma das 13 categorias fixas do enum — sempre vazio nesses testes.
        findByEnumCategory: vi.fn().mockResolvedValue([]),
    } as unknown as TransactionRepository

    return { categoryRepository, transactionRepository }
}

describe('ListCategoriesWithTransactionsUseCase', () => {
    it('returns direct-only totals/transactions when there is no hierarchy', async () => {
        const { categoryRepository, transactionRepository } = makeRepositories(
            [makeCategory({ id: 'cat-1', name: 'Transporte' })],
            { 'cat-1': [makeTransaction('t1', 50)] },
        )
        const sut = new ListCategoriesWithTransactionsUseCase(categoryRepository, transactionRepository)

        const { categories } = await sut.execute({ userId: 'user-1' })
        const cat1 = categories.find((c) => c.id === 'cat-1')!

        expect(cat1.totalSpend).toBe(50)
        expect(cat1.transactions.map((t) => t.id)).toEqual(['t1'])
        expect(cat1.parentId).toBeNull()
    })

    it('rolls up totalSpend AND transactions for a 3-level tree (Alimentação -> Supermercado -> iFood)', async () => {
        const { categoryRepository, transactionRepository } = makeRepositories(
            [
                makeCategory({ id: 'alimentacao', name: 'Alimentação', parentId: null }),
                makeCategory({ id: 'supermercado', name: 'Supermercado', parentId: 'alimentacao' }),
                makeCategory({ id: 'ifood', name: 'iFood', parentId: 'supermercado' }),
            ],
            {
                alimentacao: [makeTransaction('a1', 100)],
                supermercado: [makeTransaction('s1', 200)],
                ifood: [makeTransaction('i1', 300)],
            },
        )
        const sut = new ListCategoriesWithTransactionsUseCase(categoryRepository, transactionRepository)

        const { categories } = await sut.execute({ userId: 'user-1' })
        const byId = new Map(categories.map((c) => [c.id, c]))

        expect(byId.get('alimentacao')!.totalSpend).toBe(600)
        expect(byId.get('alimentacao')!.transactions.map((t) => t.id).sort()).toEqual(['a1', 'i1', 's1'])

        expect(byId.get('supermercado')!.totalSpend).toBe(500)
        expect(byId.get('supermercado')!.transactions.map((t) => t.id).sort()).toEqual(['i1', 's1'])

        expect(byId.get('ifood')!.totalSpend).toBe(300)
        expect(byId.get('ifood')!.transactions.map((t) => t.id)).toEqual(['i1'])
    })

    it('keeps virtual enum categories unaffected, with parentId null', async () => {
        const { categoryRepository, transactionRepository } = makeRepositories([], {})
        vi.mocked(transactionRepository.findByEnumCategory).mockImplementation(async (category: string) =>
            category === 'FOOD' ? [makeTransaction('e1', 42)] : [],
        )
        const sut = new ListCategoriesWithTransactionsUseCase(categoryRepository, transactionRepository)

        const { categories } = await sut.execute({ userId: 'user-1' })
        const enumCategory = categories.find((c) => c.id === 'enum:FOOD')

        expect(enumCategory).toBeDefined()
        expect(enumCategory!.parentId).toBeNull()
        expect(enumCategory!.isVirtual).toBe(true)
        expect(enumCategory!.totalSpend).toBe(42)
    })

    it('sorts by rolled-up totalSpend descending', async () => {
        const { categoryRepository, transactionRepository } = makeRepositories(
            [
                makeCategory({ id: 'small', name: 'Small', parentId: null }),
                makeCategory({ id: 'big-parent', name: 'Big', parentId: null }),
                makeCategory({ id: 'big-child', name: 'BigChild', parentId: 'big-parent' }),
            ],
            {
                small: [makeTransaction('s1', 10)],
                'big-child': [makeTransaction('b1', 999)],
            },
        )
        const sut = new ListCategoriesWithTransactionsUseCase(categoryRepository, transactionRepository)

        const { categories } = await sut.execute({ userId: 'user-1' })
        const realCategoryIds = categories.filter((c) => !c.isVirtual).map((c) => c.id)

        expect(realCategoryIds[0]).toBe('big-parent')
    })
})
