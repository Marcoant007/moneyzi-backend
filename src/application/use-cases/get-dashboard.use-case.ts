import type { TransactionRepository } from '@/application/repositories/transaction-repository'

export class GetDashboardUseCase {
    constructor(private readonly transactionRepository: TransactionRepository) { }

    async execute(input?: { userId?: string; month?: string }) {
        const now = new Date()
        const currentYear = now.getFullYear() // Or 2025 to match frontend hardcoding if strictly needed, but dynamic is better.
        // Frontend uses 2025, let's stick to dynamic current year or allow passing year.
        // For now, let's assume the month is for the current year.

        let startOfMonth: Date
        let endOfMonth: Date

        if (input?.month) {
            const monthIndex = parseInt(input.month) - 1
            startOfMonth = new Date(currentYear, monthIndex, 1)
            endOfMonth = new Date(currentYear, monthIndex + 1, 1)
        } else {
            startOfMonth = new Date(currentYear, now.getMonth(), 1)
            endOfMonth = new Date(currentYear, now.getMonth() + 1, 1)
        }

        const range = { start: startOfMonth, end: endOfMonth }

        const [totalsByType, expensesByCategory, lastTransactions] = await Promise.all([
            this.transactionRepository.groupTotalsByType(input?.userId, range),
            this.transactionRepository.groupExpensesByCategory(input?.userId, range),
            this.transactionRepository.findLastTransactions(input?.userId),
        ])

        const depositsTotal = Number(totalsByType.find(t => t.type === 'DEPOSIT')?._sum.amount || 0)
        const investmentsTotal = Number(totalsByType.find(t => t.type === 'INVESTMENT')?._sum.amount || 0)
        const expensesTotal = Number(totalsByType.find(t => t.type === 'EXPENSE')?._sum.amount || 0)

        const balance = depositsTotal - investmentsTotal - expensesTotal
        const transactionsTotal = depositsTotal + investmentsTotal + expensesTotal

        const typesPercentage = {
            DEPOSIT: transactionsTotal ? Math.round((depositsTotal / transactionsTotal) * 100) : 0,
            INVESTMENT: transactionsTotal ? Math.round((investmentsTotal / transactionsTotal) * 100) : 0,
            EXPENSE: transactionsTotal ? Math.round((expensesTotal / transactionsTotal) * 100) : 0,
        }

        const totalExpensePerCategory = expensesByCategory.map(c => ({
            category: c.category,
            totalAmount: Number(c._sum.amount),
            percentageOfTotal: expensesTotal ? Math.round((Number(c._sum.amount) / expensesTotal) * 100) : 0,
        }))

        return {
            balance,
            depositsTotal,
            investmentsTotal,
            expensesTotal,
            typesPercentage,
            totalExpensePerCategory,
            lastTransactions,
        }
    }
}
