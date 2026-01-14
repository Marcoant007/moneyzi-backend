import { TransactionRepository } from '@/application/repositories/transaction-repository'
import { CategoryRepository } from '@/application/repositories/category-repository'
import { startOfMonth, addMonths, endOfMonth, format } from 'date-fns'
import { TransactionType } from '@prisma/client'

export interface DashboardReportOutput {
    forecast: Array<{
        period: string
        recurringIncome: number
        recurringExpenses: number
        balance: number
    }>
    pie: Array<{ id: string; label: string; value: number }>
    categories: Array<{ category: string; amount: number }>
    insights: {
        forecastTotal: number
        fixedRatio: number
        topCategory: { category: string; amount: number } | null
    }
    rule5030: {
        essentials: number
        lifestyle: number
        savings: number
        percentages: {
            essentials: number
            lifestyle: number
            savings: number
        }
    }
}

export class GetDashboardReportUseCase {
    constructor(
        private transactionRepository: TransactionRepository,
        private categoryRepository: CategoryRepository
    ) { }

    async execute(userId: string, period: string = 'thisMonth'): Promise<DashboardReportOutput> {
        const now = new Date()
        let start = startOfMonth(now)
        let end = endOfMonth(now)
        let monthsToForecast = 1 // Padrão: apenas este mês

        if (period === 'last3Months') {
            monthsToForecast = 3
            end = endOfMonth(addMonths(now, 2))
        } else if (period === 'last6Months') {
            monthsToForecast = 6
            end = endOfMonth(addMonths(now, 5))
        } else if (period === 'last12Months') {
            monthsToForecast = 12
            end = endOfMonth(addMonths(now, 11))
        }

        const range = { start, end }

        const [
            recurrenceStats,
            categoryStats,
            userCategories
        ] = await Promise.all([
            this.transactionRepository.groupExpensesByRecurrence(userId, range),
            this.transactionRepository.groupExpensesByCategoryId(userId, range),
            this.categoryRepository.listByUserId(userId)
        ])

        // 3. Process Pie Data (Fixed vs Variable)
        const pieData = [
            { id: 'Fixed', label: 'Fixed', value: 0 },
            { id: 'Variable', label: 'Variable', value: 0 }
        ]

        recurrenceStats.forEach(stat => {
            const val = Number(stat._sum.amount || 0)
            if (stat.isRecurring) {
                pieData[0].value += val
            } else {
                pieData[1].value += val
            }
        })

        // 4. Process Category Data
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

        categoryStats.forEach(stat => {
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

        const categoriesData = Array.from(categoriesDataMap.entries())
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount)

        // Buscar previsão de receitas e despesas recorrentes
        const forecastData = await this.fetchRecurringForecast(userId, start, end)

        const totalExpenses = pieData[0].value + pieData[1].value
        const fixedRatio = totalExpenses > 0 ? (pieData[0].value / totalExpenses) * 100 : 0

        // Calcular regra 50/30/20
        const rule5030Data = this.calculate5030Rule(categoriesData, totalExpenses)

        return {
            forecast: forecastData,
            pie: pieData,
            categories: categoriesData,
            insights: {
                forecastTotal: totalExpenses,
                fixedRatio,
                topCategory: categoriesData.length > 0 ? categoriesData[0] : null
            },
            rule5030: rule5030Data
        }
    }

    private calculate5030Rule(categories: Array<{ category: string; amount: number }>, totalExpenses: number) {
        // Categorias essenciais (50%)
        const essentialCategories = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Utilidades']

        // Categorias de estilo de vida (30%)
        const lifestyleCategories = ['Entretenimento', 'Lanche', 'Food Delivery', 'Streaming', 'Assinatura', 'Jogos']

        let essentials = 0
        let lifestyle = 0

        categories.forEach(cat => {
            if (essentialCategories.includes(cat.category)) {
                essentials += cat.amount
            } else if (lifestyleCategories.includes(cat.category)) {
                lifestyle += cat.amount
            }
        })

        // Economia = Tudo que não foi gasto (20% ideal)
        const savings = Math.max(0, totalExpenses - essentials - lifestyle)

        return {
            essentials,
            lifestyle,
            savings,
            percentages: {
                essentials: totalExpenses > 0 ? (essentials / totalExpenses) * 100 : 0,
                lifestyle: totalExpenses > 0 ? (lifestyle / totalExpenses) * 100 : 0,
                savings: totalExpenses > 0 ? (savings / totalExpenses) * 100 : 0
            }
        }
    }

    private async fetchRecurringForecast(userId: string, start: Date, end: Date) {
        const months: { start: Date, end: Date, label: string }[] = []
        let current = new Date(start)
        while (current <= end) {
            months.push({
                start: startOfMonth(current),
                end: endOfMonth(current),
                label: format(current, 'MMM/yy')
            })
            current.setMonth(current.getMonth() + 1)
        }

        const results = await Promise.all(
            months.map(async m => {
                // Buscar receitas recorrentes (DEPOSIT)
                const recurringIncome = await this.transactionRepository.aggregateRecurringAmount({
                    start: m.start,
                    end: m.end,
                    userId,
                    type: TransactionType.DEPOSIT
                })

                // Buscar despesas recorrentes
                const recurringExpenses = await this.transactionRepository.aggregateRecurringAmount({
                    start: m.start,
                    end: m.end,
                    userId,
                    type: TransactionType.EXPENSE
                })

                const income = Number(recurringIncome._sum.amount || 0)
                const expenses = Number(recurringExpenses._sum.amount || 0)

                return {
                    label: m.label,
                    recurringIncome: income,
                    recurringExpenses: expenses,
                    balance: income - expenses
                }
            })
        )

        return results.map(r => ({
            period: r.label,
            recurringIncome: r.recurringIncome,
            recurringExpenses: r.recurringExpenses,
            balance: r.balance
        }))
    }
}
