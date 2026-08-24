import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '@prisma/client'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import { GetCategoryMonthMatrixUseCase } from '../dashboard-use-case/get-category-month-matrix.use-case'

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 'cat-default',
        name: 'Categoria',
        userId: 'user-1',
        parentId: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        ...overrides,
    } as Category
}

type GroupedRow = {
    categoryId: string | null
    category: string
    type: 'EXPENSE' | 'DEPOSIT' | 'INVESTMENT'
    _sum: { amount: number }
}

function row(overrides: Partial<GroupedRow>): GroupedRow {
    return {
        categoryId: null,
        category: 'OTHER',
        type: 'EXPENSE',
        _sum: { amount: 0 },
        ...overrides,
    }
}

describe('GetCategoryMonthMatrixUseCase', () => {
    let transactionRepository: TransactionRepository
    let categoryRepository: CategoryRepository
    let sut: GetCategoryMonthMatrixUseCase

    const alimentacao = makeCategory({ id: 'alimentacao', name: 'Alimentação' })
    const supermercado = makeCategory({ id: 'supermercado', name: 'Supermercado', parentId: 'alimentacao' })
    const ifood = makeCategory({ id: 'ifood', name: 'iFood', parentId: 'supermercado' })
    const salario = makeCategory({ id: 'salario', name: 'Salário' })

    beforeEach(() => {
        transactionRepository = {
            groupTransactionsByCategoryId: vi.fn(),
        } as unknown as TransactionRepository

        categoryRepository = {
            listByUserId: vi.fn(),
        } as unknown as CategoryRepository

        sut = new GetCategoryMonthMatrixUseCase(transactionRepository, categoryRepository)
    })

    function mockMonthlyRows(byMonthIndex: Record<number, GroupedRow[]>) {
        vi.mocked(transactionRepository.groupTransactionsByCategoryId).mockImplementation(
            async (_userId: string, range?: { start: Date; end: Date }) => {
                const monthIndex = range ? range.start.getMonth() : 0
                return (byMonthIndex[monthIndex] ?? []) as any
            },
        )
    }

    it('always returns 12 months, index 0 = January of the requested year, regardless of the real current date', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])
        mockMonthlyRows({})

        const result = await sut.execute({ userId: 'user-1', year: 2023 })

        expect(result.months).toEqual([
            '2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06',
            '2023-07', '2023-08', '2023-09', '2023-10', '2023-11', '2023-12',
        ])
    })

    it('rolls descendant totals into the depth-1 row, keeping sub-rows direct-only', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([alimentacao, supermercado, ifood])
        mockMonthlyRows({
            0: [
                row({ categoryId: 'alimentacao', type: 'EXPENSE', _sum: { amount: 50 } }),
                row({ categoryId: 'ifood', type: 'EXPENSE', _sum: { amount: 30 } }),
            ],
        })

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        const topRow = result.expense.rows.find((r) => r.id === 'alimentacao')
        const supermercadoRow = result.expense.rows.find((r) => r.id === 'supermercado')
        const ifoodRow = result.expense.rows.find((r) => r.id === 'ifood')

        expect(topRow?.monthlyTotals[0]).toBe(80) // 50 direto + 30 do neto
        expect(supermercadoRow?.monthlyTotals[0]).toBe(0) // sem valor próprio
        expect(ifoodRow?.monthlyTotals[0]).toBe(30) // só o valor direto, não somado de novo
    })

    it('keeps an intermediate category as a row even with zero of its own spend, when a deeper child qualifies (path node)', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([alimentacao, supermercado, ifood])
        mockMonthlyRows({
            0: [row({ categoryId: 'ifood', type: 'EXPENSE', _sum: { amount: 30 } })],
        })

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        const ids = result.expense.rows.map((r) => r.id)
        expect(ids).toEqual(['alimentacao', 'supermercado', 'ifood'])
    })

    it('shows a category in both sections when it has both expense and income activity, each with only its own type amount', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([salario])
        mockMonthlyRows({
            0: [
                row({ categoryId: 'salario', type: 'DEPOSIT', _sum: { amount: 3000 } }),
                row({ categoryId: 'salario', type: 'EXPENSE', _sum: { amount: 100 } }),
            ],
        })

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        const incomeRow = result.income.rows.find((r) => r.id === 'salario')
        const expenseRow = result.expense.rows.find((r) => r.id === 'salario')

        expect(incomeRow?.monthlyTotals[0]).toBe(3000)
        expect(expenseRow?.monthlyTotals[0]).toBe(100)
    })

    it('combines DEPOSIT and INVESTMENT into the income side of a category', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([salario])
        mockMonthlyRows({
            0: [
                row({ categoryId: 'salario', type: 'DEPOSIT', _sum: { amount: 3000 } }),
                row({ categoryId: 'salario', type: 'INVESTMENT', _sum: { amount: 500 } }),
            ],
        })

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        expect(result.income.rows.find((r) => r.id === 'salario')?.monthlyTotals[0]).toBe(3500)
    })

    it('collapses transactions without a valid categoryId into a single legacy row per section, regardless of the enum value', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])
        mockMonthlyRows({
            0: [
                row({ categoryId: null, category: 'FOOD', type: 'EXPENSE', _sum: { amount: 20 } }),
                row({ categoryId: null, category: 'TRANSPORTATION', type: 'EXPENSE', _sum: { amount: 10 } }),
                row({ categoryId: 'orphan-id', category: 'OTHER', type: 'EXPENSE', _sum: { amount: 5 } }),
            ],
        })

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        expect(result.expense.rows).toHaveLength(1)
        expect(result.expense.rows[0]).toMatchObject({ id: 'legacy-expense', isLegacy: true })
        expect(result.expense.rows[0].monthlyTotals[0]).toBe(35)
    })

    it('omits a category whose entire year is zero', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([alimentacao])
        mockMonthlyRows({})

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        expect(result.expense.rows).toHaveLength(0)
        expect(result.income.rows).toHaveLength(0)
    })

    it('computes balance as income subtotal minus expense subtotal for every month', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([salario, alimentacao])
        mockMonthlyRows({
            0: [
                row({ categoryId: 'salario', type: 'DEPOSIT', _sum: { amount: 3000 } }),
                row({ categoryId: 'alimentacao', type: 'EXPENSE', _sum: { amount: 800 } }),
            ],
        })

        const result = await sut.execute({ userId: 'user-1', year: 2026 })

        for (let i = 0; i < 12; i++) {
            expect(result.balance[i]).toBe(result.income.subtotal[i] - result.expense.subtotal[i])
        }
        expect(result.balance[0]).toBe(2200)
    })
})
