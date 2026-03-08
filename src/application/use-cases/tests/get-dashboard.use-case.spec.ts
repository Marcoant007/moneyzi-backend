import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { AccountRepository } from '@/application/repositories/account-repository'
import { GetDashboardUseCase } from '../dashboard-use-case/get-dashboard.use-case'

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
        date: new Date('2026-02-10T10:00:00.000Z'),
        dueDate: null,
        isRecurring: false,
        paymentStatus: 'PAID',
        paidAt: new Date('2026-03-06T12:00:00.000Z'),
        createdAt: new Date('2026-02-10T10:00:00.000Z'),
        updatedAt: new Date('2026-02-10T10:00:00.000Z'),
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

describe('GetDashboardUseCase', () => {
    let transactionRepository: TransactionRepository
    let categoryRepository: CategoryRepository
    let accountRepository: AccountRepository
    let sut: GetDashboardUseCase

    beforeEach(() => {
        transactionRepository = {
            findDashboardTransactions: vi.fn(),
        } as unknown as TransactionRepository

        categoryRepository = {
            listByUserId: vi.fn(),
        } as unknown as CategoryRepository

        accountRepository = {
            listByUserIdWithBalance: vi.fn(),
        } as unknown as AccountRepository

        sut = new GetDashboardUseCase(transactionRepository, categoryRepository, accountRepository)
    })

    it('breaks down paid credit-card statement by original categories', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'home-1',
                name: 'Aluguel',
                type: 'EXPENSE',
                amount: 1000 as any,
                category: 'HOUSING',
                creditCardId: null,
                paidAt: new Date('2026-03-05T12:00:00.000Z'),
            }),
            makeTx({
                id: 'card-food',
                name: 'Mercado',
                type: 'EXPENSE',
                amount: 300 as any,
                category: 'FOOD',
                creditCardId: 'card-1',
                creditCard: { id: 'card-1', name: 'Inter', dueDay: 6, closingDay: 28 } as any,
                dueDate: new Date('2026-03-06T12:00:00.000Z'),
                date: new Date('2026-02-12T10:00:00.000Z'),
                paidAt: new Date('2026-03-06T12:00:00.000Z'),
            }),
            makeTx({
                id: 'card-transport',
                name: 'Uber',
                type: 'EXPENSE',
                amount: 200 as any,
                category: 'TRANSPORTATION',
                creditCardId: 'card-1',
                creditCard: { id: 'card-1', name: 'Inter', dueDay: 6, closingDay: 28 } as any,
                dueDate: new Date('2026-03-06T12:00:00.000Z'),
                date: new Date('2026-02-20T10:00:00.000Z'),
                paidAt: new Date('2026-03-06T12:00:00.000Z'),
            }),
        ])

        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])
        vi.mocked(accountRepository.listByUserIdWithBalance).mockResolvedValue([])

        const result = await sut.execute({ userId: 'user-1', month: '03', year: '2026' })

        expect(result.expensesTotal).toBe(1500)

        expect(result.totalExpensePerCategory).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ category: 'Moradia', totalAmount: 1000 }),
                expect.objectContaining({ category: 'Alimentacao', totalAmount: 300 }),
                expect.objectContaining({ category: 'Transporte', totalAmount: 200 }),
            ])
        )

        expect(result.totalExpensePerCategory.some((item) => item.category === 'Fatura de cartao')).toBe(false)
        expect(result.lastTransactions.some((tx) => tx.name === 'Fatura Inter')).toBe(true)
    })

    it('subtracts credit-card refunds from the original category', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([
            makeTx({
                id: 'card-expense',
                type: 'EXPENSE',
                amount: 500 as any,
                category: 'FOOD',
                creditCardId: 'card-1',
                creditCard: { id: 'card-1', name: 'Inter', dueDay: 10, closingDay: 28 } as any,
                dueDate: new Date('2026-03-10T12:00:00.000Z'),
                paidAt: new Date('2026-03-10T12:00:00.000Z'),
            }),
            makeTx({
                id: 'card-refund',
                type: 'DEPOSIT',
                amount: 100 as any,
                category: 'FOOD',
                creditCardId: 'card-1',
                creditCard: { id: 'card-1', name: 'Inter', dueDay: 10, closingDay: 28 } as any,
                dueDate: new Date('2026-03-10T12:00:00.000Z'),
                paidAt: new Date('2026-03-10T12:00:00.000Z'),
            }),
        ])

        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])
        vi.mocked(accountRepository.listByUserIdWithBalance).mockResolvedValue([])

        const result = await sut.execute({ userId: 'user-1', month: '03', year: '2026' })

        const foodCategory = result.totalExpensePerCategory.find((item) => item.category === 'Alimentacao')

        expect(result.expensesTotal).toBe(400)
        expect(foodCategory?.totalAmount).toBe(400)
    })

    it('sums portfolio investments from investment and piggy-bank accounts', async () => {
        vi.mocked(transactionRepository.findDashboardTransactions).mockResolvedValue([])
        vi.mocked(categoryRepository.listByUserId).mockResolvedValue([])
        vi.mocked(accountRepository.listByUserIdWithBalance).mockResolvedValue([
            { id: 'a1', type: 'PIGGY_BANK', balance: 750 } as any,
            { id: 'a2', type: 'INVESTMENT', balance: 250 } as any,
            { id: 'a3', type: 'CHECKING', balance: 5000 } as any,
        ])

        const result = await sut.execute({ userId: 'user-1', month: '03', year: '2026' })

        expect(result.investmentsPortfolioTotal).toBe(1000)
        expect(result.investmentsTotal).toBe(0)
    })
})
