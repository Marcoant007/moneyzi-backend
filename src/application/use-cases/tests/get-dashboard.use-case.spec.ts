import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransactionRepository } from '@/application/repositories/transaction-repository'
import { CategoryRepository } from '@/application/repositories/category-repository'
import { GetDashboardUseCase } from '../get-dashboard.use-case'

describe('GetDashboardUseCase', () => {
    let transactionRepository: TransactionRepository
    let categoryRepository: CategoryRepository
    let sut: GetDashboardUseCase

    beforeEach(() => {
        transactionRepository = {
            groupTotalsByType: vi.fn(),
            groupExpensesByCategory: vi.fn(),
            findLastTransactions: vi.fn(),
            create: vi.fn(),
            groupExpensesByCategoryId: vi.fn(),
            groupExpensesByRecurrence: vi.fn(),
            aggregateMonthlyAmount: vi.fn(),
        } as unknown as TransactionRepository

        categoryRepository = {
            listByUserId: vi.fn(),
        } as unknown as CategoryRepository

        sut = new GetDashboardUseCase(transactionRepository, categoryRepository)
    })

    it('should calculate dashboard totals correctly', async () => {
        vi.mocked(transactionRepository.groupTotalsByType).mockResolvedValue([
            { type: 'DEPOSIT', _sum: { amount: 5000 as any } },
            { type: 'EXPENSE', _sum: { amount: 2000 as any } },
            { type: 'INVESTMENT', _sum: { amount: 1000 as any } },
        ])
        vi.mocked(transactionRepository.groupExpensesByCategory).mockResolvedValue([])
        vi.mocked(transactionRepository.findLastTransactions).mockResolvedValue([])
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])

        const result = await sut.execute({ userId: 'user-1', month: '12' })

        expect(result.depositsTotal).toBe(5000)
        expect(result.expensesTotal).toBe(2000)
        expect(result.investmentsTotal).toBe(1000)
        expect(result.balance).toBe(3000) // 5000 - 2000
    })

    it('should calculate percentages correctly', async () => {
        vi.mocked(transactionRepository.groupTotalsByType).mockResolvedValue([
            { type: 'DEPOSIT', _sum: { amount: 500 as any } },
            { type: 'EXPENSE', _sum: { amount: 500 as any } },
        ])
        vi.mocked(transactionRepository.groupExpensesByCategory).mockResolvedValue([])
        vi.mocked(transactionRepository.findLastTransactions).mockResolvedValue([])
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])

        const result = await sut.execute({ userId: 'user-1', month: '12' })

        expect(result.typesPercentage.DEPOSIT).toBe(50)
        expect(result.typesPercentage.EXPENSE).toBe(50)
        expect(result.typesPercentage.INVESTMENT).toBe(0)
    })
})
