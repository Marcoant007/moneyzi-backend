import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'

export class GetDashboardUseCase {
    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly categoryRepository: CategoryRepository
    ) { }

    async execute(input?: { userId?: string; month?: string; year?: string }) {
        const now = new Date()
        const currentYear = now.getFullYear()
        const targetYear = input?.year ? parseInt(input.year) : currentYear

        let startOfMonth: Date
        let endOfMonth: Date

        if (input?.month) {
            const monthIndex = parseInt(input.month) - 1
            startOfMonth = new Date(targetYear, monthIndex, 1)
            endOfMonth = new Date(targetYear, monthIndex + 1, 1)
        } else {
            startOfMonth = new Date(targetYear, now.getMonth(), 1)
            endOfMonth = new Date(targetYear, now.getMonth() + 1, 1)
        }

        const range = { start: startOfMonth, end: endOfMonth }

        const [totalsByType, expensesByCategory, lastTransactions, userCategories] = await Promise.all([
            this.transactionRepository.groupTotalsByType(input?.userId, range),
            this.transactionRepository.groupExpensesByCategory(input?.userId, range),
            this.transactionRepository.findLastTransactions(input?.userId),
            input?.userId ? this.categoryRepository.listByUserId(input.userId) : Promise.resolve([])
        ])

        const depositsTotal = Number(totalsByType.find(t => t.type === 'DEPOSIT')?._sum.amount || 0)
        const investmentsTotal = Number(totalsByType.find(t => t.type === 'INVESTMENT')?._sum.amount || 0)
        const expensesTotal = Number(totalsByType.find(t => t.type === 'EXPENSE')?._sum.amount || 0)

        const balance = depositsTotal - expensesTotal
        const transactionsTotal = depositsTotal + investmentsTotal + expensesTotal

        const typesPercentage = {
            DEPOSIT: transactionsTotal ? Math.round((depositsTotal / transactionsTotal) * 100) : 0,
            INVESTMENT: transactionsTotal ? Math.round((investmentsTotal / transactionsTotal) * 100) : 0,
            EXPENSE: transactionsTotal ? Math.round((expensesTotal / transactionsTotal) * 100) : 0,
        }

        const TRANSACTION_CATEGORY_LABELS: Record<string, string> = {
            EDUCATION: "Educação",
            ENTERTAINMENT: "Entretenimento",
            SERVICES: "Serviços",
            FOOD: "Alimentação",
            FOOD_DELIVERY: "Lanche",
            GAMING: "Jogos",
            HEALTH: "Saúde",
            HOUSING: "Moradia",
            OTHER: "Outros",
            SALARY: "Salário",
            TRANSPORTATION: "Transporte",
            SIGNATURE: "Assinatura",
            STREAMING: "Streaming",
            UTILITY: "Utilidades",
        };

        const categoryMap = new Map(userCategories.map(c => [c.id, c.name]))
        const categoriesDataMap = new Map<string, number>()

        expensesByCategory.forEach(stat => {
            const amount = Number(stat._sum.amount || 0)
            if (amount === 0) return

            let categoryName = 'Outros'
            if (stat.categoryId) {
                categoryName = categoryMap.get(stat.categoryId) || 'Desconhecido'
            } else if (stat.category) {
                categoryName = TRANSACTION_CATEGORY_LABELS[stat.category] || 'Outros'
            }

            const current = categoriesDataMap.get(categoryName) || 0
            categoriesDataMap.set(categoryName, current + amount)
        })

        const totalExpensePerCategory = Array.from(categoriesDataMap.entries())
            .map(([category, amount]) => ({
                category,
                totalAmount: amount,
                percentageOfTotal: expensesTotal ? Math.round((amount / expensesTotal) * 100) : 0,
            }))
            .sort((a, b) => b.totalAmount - a.totalAmount)

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
