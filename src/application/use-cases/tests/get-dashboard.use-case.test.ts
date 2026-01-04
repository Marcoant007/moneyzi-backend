import { describe, it, expect, vi } from 'vitest'
import { GetDashboardUseCase } from '../get-dashboard.use-case'

describe('GetDashboardUseCase', () => {
    it('calculates totals and categories when month is provided and user has categories', async () => {
        const transactionRepository = {
            groupTotalsByType: vi.fn().mockResolvedValue([
                { type: 'DEPOSIT', _sum: { amount: 100 } },
                { type: 'INVESTMENT', _sum: { amount: 10 } },
                { type: 'EXPENSE', _sum: { amount: 40 } },
            ]),
            groupExpensesByCategory: vi.fn().mockResolvedValue([
                { categoryId: null, category: 'FOOD', _sum: { amount: 30 } },
                { categoryId: 'c1', category: null, _sum: { amount: 10 } },
            ]),
            findLastTransactions: vi.fn().mockResolvedValue([{ id: 't1' }]),
        }

        const categoryRepository = {
            listByUserId: vi.fn().mockResolvedValue([{ id: 'c1', name: 'MyCategory' }]),
        }

        const uc = new GetDashboardUseCase(transactionRepository as any, categoryRepository as any)

        const result = await uc.execute({ userId: 'u1', month: '1' })

        expect(result.depositsTotal).toBe(100)
        expect(result.investmentsTotal).toBe(10)
        expect(result.expensesTotal).toBe(40)
        expect(result.typesPercentage.DEPOSIT).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.totalExpensePerCategory)).toBe(true)
        expect(result.lastTransactions).toEqual([{ id: 't1' }])
    })

    it('uses current month when month not provided and returns empty categories for anonymous', async () => {
        const transactionRepository = {
            groupTotalsByType: vi.fn().mockResolvedValue([]),
            groupExpensesByCategory: vi.fn().mockResolvedValue([]),
            findLastTransactions: vi.fn().mockResolvedValue([]),
        }

        const categoryRepository = {
            listByUserId: vi.fn(),
        }

        const uc = new GetDashboardUseCase(transactionRepository as any, categoryRepository as any)

        const result = await uc.execute()

        expect(result.depositsTotal).toBe(0)
        expect(result.expensesTotal).toBe(0)
        expect(result.totalExpensePerCategory.length).toBe(0)
    })
})
