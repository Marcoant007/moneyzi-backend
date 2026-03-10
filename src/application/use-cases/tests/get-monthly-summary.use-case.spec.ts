import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, Prisma } from '@prisma/client'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import { GetMonthlySummaryUseCase } from '../dashboard-use-case/get-monthly-summary.use-case'

type DashboardTransaction = Prisma.TransactionGetPayload<{ include: { creditCard: true } }>

function makeTx(overrides: Partial<DashboardTransaction> = {}): DashboardTransaction {
    return {
        id: 'tx-default',
        name: 'Transacao',
        description: null,
        type: 'EXPENSE',
        amount: 100 as any,
        category: 'OTHER',
        paymentMethod: 'PIX',
        date: new Date('2026-03-10T10:00:00.000Z'),
        dueDate: null,
        isRecurring: false,
        paymentStatus: 'PAID',
        paidAt: new Date('2026-03-10T10:00:00.000Z'),
        createdAt: new Date('2026-03-10T10:00:00.000Z'),
        updatedAt: new Date('2026-03-10T10:00:00.000Z'),
        deletedAt: null,
        userId: 'user-1',
        categoryId: null,
        creditCardId: null,
        accountId: null,
        importJobId: null,
        creditCard: null,
        ...overrides,
    } as DashboardTransaction
}

describe('GetMonthlySummaryUseCase', () => {
    let transactionRepository: TransactionRepository
    let categoryRepository: CategoryRepository
    let sut: GetMonthlySummaryUseCase

    beforeEach(() => {
        transactionRepository = {
            findDashboardTransactions: vi.fn(),
        } as unknown as TransactionRepository

        categoryRepository = {
            listByUserId: vi.fn(),
        } as unknown as CategoryRepository

        sut = new GetMonthlySummaryUseCase(transactionRepository, categoryRepository)
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])
    })

    it('classifies fixed and variable expenses and keeps dashboard endpoint assumptions', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'income',
                type: 'DEPOSIT',
                amount: 10000 as any,
                category: 'SALARY',
                paymentMethod: 'PIX',
            }),
            makeTx({
                id: 'housing',
                type: 'EXPENSE',
                amount: 3000 as any,
                category: 'HOUSING',
                isRecurring: true,
                paymentMethod: 'BANK_TRANSFER',
            }),
            makeTx({
                id: 'food',
                type: 'EXPENSE',
                amount: 1500 as any,
                category: 'FOOD',
            }),
            makeTx({
                id: 'delivery',
                type: 'EXPENSE',
                amount: 800 as any,
                category: 'FOOD_DELIVERY',
                paymentMethod: 'CREDIT_CARD',
                creditCardId: 'card-1',
            }),
        ])

        const result = await sut.execute('user-1', '2026-03')

        expect(result.income).toBe(10000)
        expect(result.expenses).toBe(5300)
        expect(result.fixedExpenses.total).toBe(3000)
        expect(result.variableExpenses.total).toBe(2300)
        expect(result.variableExpenses.topCategory?.category).toBe('Alimentacao')
        expect(result.creditCardAnalysis.total).toBe(800)
        expect(result.commitmentRate).toBe(53)
    })

    it('prioritizes top credit-card category as major offender when card dominates', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'income',
                type: 'DEPOSIT',
                amount: 5000 as any,
                category: 'SALARY',
                paymentMethod: 'PIX',
            }),
            makeTx({
                id: 'fixed',
                type: 'EXPENSE',
                amount: 500 as any,
                category: 'HOUSING',
                isRecurring: true,
            }),
            makeTx({
                id: 'food',
                type: 'EXPENSE',
                amount: 800 as any,
                category: 'FOOD',
                paymentMethod: 'PIX',
            }),
            makeTx({
                id: 'delivery',
                type: 'EXPENSE',
                amount: 1500 as any,
                category: 'FOOD_DELIVERY',
                paymentMethod: 'CREDIT_CARD',
                creditCardId: 'card-1',
            }),
            makeTx({
                id: 'entertainment',
                type: 'EXPENSE',
                amount: 1000 as any,
                category: 'ENTERTAINMENT',
                paymentMethod: 'CREDIT_CARD',
                creditCardId: 'card-1',
            }),
        ])

        const result = await sut.execute('user-1', '2026-03')

        expect(result.creditCardAnalysis.isDominant).toBe(true)
        expect(result.majorOffender?.origin).toBe('credit_card')
        expect(result.majorOffender?.category).toBe('Delivery')
        expect(result.majorOffender?.paymentMethodFocus).toBe('credit_card')
    })

    it('uses fixed top category as major offender when fixed expenses dominate and card does not', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'income',
                type: 'DEPOSIT',
                amount: 5000 as any,
                category: 'SALARY',
                paymentMethod: 'PIX',
            }),
            makeTx({
                id: 'housing',
                type: 'EXPENSE',
                amount: 3000 as any,
                category: 'HOUSING',
                paymentMethod: 'BANK_TRANSFER',
                isRecurring: true,
            }),
            makeTx({
                id: 'utility',
                type: 'EXPENSE',
                amount: 600 as any,
                category: 'UTILITY',
                paymentMethod: 'PIX',
                isRecurring: true,
            }),
            makeTx({
                id: 'variable',
                type: 'EXPENSE',
                amount: 500 as any,
                category: 'FOOD',
                paymentMethod: 'PIX',
            }),
        ])

        const result = await sut.execute('user-1', '2026-03')

        expect(result.creditCardAnalysis.isDominant).toBe(false)
        expect(result.majorOffender?.origin).toBe('fixed')
        expect(result.majorOffender?.category).toBe('Moradia')
    })

    it('handles zero-income months and custom categories with conservative 50/30/20 fallback', async () => {
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([
            { id: 'custom-1', name: 'Viagens' } as Category,
        ])
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'custom-expense',
                type: 'EXPENSE',
                amount: 1000 as any,
                category: 'OTHER',
                categoryId: 'custom-1',
                paymentMethod: 'CREDIT_CARD',
                creditCardId: 'card-1',
            }),
        ])

        const result = await sut.execute('user-1', '2026-03')

        expect(result.income).toBe(0)
        expect(result.rule503020.needs.actualPercent).toBe(0)
        expect(result.rule503020.wants.actualPercent).toBe(0)
        expect(result.rule503020.future.actualPercent).toBe(0)
        expect(result.rule503020.needs.status).toBe('bad')
        expect(result.rule503020.wants.status).toBe('bad')
        expect(result.rule503020.future.status).toBe('bad')
        expect(result.topOffenders[0]?.category).toBe('Viagens')
    })

    it('generates actionable insights and low health score under pressure scenario', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'income',
                type: 'DEPOSIT',
                amount: 6000 as any,
                category: 'SALARY',
                paymentMethod: 'PIX',
            }),
            makeTx({
                id: 'housing',
                type: 'EXPENSE',
                amount: 1800 as any,
                category: 'HOUSING',
                isRecurring: true,
                paymentMethod: 'BANK_TRANSFER',
            }),
            makeTx({
                id: 'delivery',
                type: 'EXPENSE',
                amount: 1500 as any,
                category: 'FOOD_DELIVERY',
                paymentMethod: 'CREDIT_CARD',
                creditCardId: 'card-1',
            }),
            makeTx({
                id: 'entertainment',
                type: 'EXPENSE',
                amount: 1200 as any,
                category: 'ENTERTAINMENT',
                paymentMethod: 'CREDIT_CARD',
                creditCardId: 'card-1',
            }),
            makeTx({
                id: 'gaming',
                type: 'EXPENSE',
                amount: 900 as any,
                category: 'GAMING',
                paymentMethod: 'PIX',
            }),
        ])

        const result = await sut.execute('user-1', '2026-03')

        expect(result.healthScore.status).toBe('risk')
        expect(result.healthScore.value).toBeLessThan(60)
        expect(result.insights.length).toBe(3)
        expect(result.insights.join(' ')).toContain('cartao')
        expect(result.insights.join(' ')).toContain('Delivery')
    })
})
