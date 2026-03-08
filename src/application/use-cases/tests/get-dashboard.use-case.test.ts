import { describe, expect, it, vi } from 'vitest'
import { GetDashboardUseCase } from '../dashboard-use-case/get-dashboard.use-case'

describe('GetDashboardUseCase (smoke)', () => {
    it('returns zeroed totals when userId is not provided', async () => {
        const transactionRepository = {
            findDashboardTransactions: vi.fn(),
        }

        const categoryRepository = {
            listByUserId: vi.fn(),
        }

        const sut = new GetDashboardUseCase(
            transactionRepository as any,
            categoryRepository as any,
        )

        const result = await sut.execute({ month: '03', year: '2026' })

        expect(result.balance).toBe(0)
        expect(result.depositsTotal).toBe(0)
        expect(result.investmentsTotal).toBe(0)
        expect(result.expensesTotal).toBe(0)
        expect(result.totalExpensePerCategory).toEqual([])
        expect(result.lastTransactions).toEqual([])
        expect(transactionRepository.findDashboardTransactions).not.toHaveBeenCalled()
        expect(categoryRepository.listByUserId).not.toHaveBeenCalled()
    })
})
