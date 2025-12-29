import { TransactionRepository } from '@/application/repositories/transaction-repository'
import { CategoryRepository } from '@/application/repositories/category-repository'
import { startOfMonth, subMonths, endOfMonth, format } from 'date-fns'

export interface DashboardReportOutput {
    forecast: Array<{ period: string; predicted: number; budget: number }>
    pie: Array<{ id: string; label: string; value: number }>
    categories: Array<{ category: string; amount: number }>
    insights: {
        forecastTotal: number
        fixedRatio: number
        topCategory: { category: string; amount: number } | null
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
        let monthsToLookBack = 0

        if (period === 'last3Months') {
            monthsToLookBack = 3
            start = startOfMonth(subMonths(now, 2))
        } else if (period === 'last6Months') {
            monthsToLookBack = 6
            start = startOfMonth(subMonths(now, 5))
        } else if (period === 'last12Months') {
            monthsToLookBack = 12
            start = startOfMonth(subMonths(now, 11))
        }

        const range = { start, end }

        const [
            recurrenceStats,
            categoryStats,
            userCategories,
            monthlyAggregates
        ] = await Promise.all([
            this.transactionRepository.groupExpensesByRecurrence(userId, range),
            this.transactionRepository.groupExpensesByCategoryId(userId, range),
            this.categoryRepository.listByUserId(userId),
            this.fetchMonthlyHistory(userId, start, end)
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
        const categoryMap = new Map(userCategories.map(c => [c.id, c.name]))
        const categoriesData = categoryStats
            .map(stat => ({
                category: stat.categoryId ? categoryMap.get(stat.categoryId) || 'Unknown' : 'Uncategorized',
                amount: Number(stat._sum.amount || 0)
            }))
            .sort((a, b) => b.amount - a.amount)

        const forecastData = monthlyAggregates.map(m => ({
            period: m.label,
            predicted: m.amount,
            budget: 6000
        }))

        const totalExpenses = pieData[0].value + pieData[1].value
        const fixedRatio = totalExpenses > 0 ? (pieData[0].value / totalExpenses) * 100 : 0

        return {
            forecast: forecastData,
            pie: pieData,
            categories: categoriesData,
            insights: {
                forecastTotal: totalExpenses,
                fixedRatio,
                topCategory: categoriesData.length > 0 ? categoriesData[0] : null
            }
        }
    }

    private async fetchMonthlyHistory(userId: string, start: Date, end: Date) {
        const months: { start: Date, end: Date, label: string }[] = []
        let current = new Date(start)
        while (current <= end) {
            months.push({
                start: startOfMonth(current),
                end: endOfMonth(current),
                label: format(current, 'MMM yy')
            })
            current.setMonth(current.getMonth() + 1)
        }

        const results = await Promise.all(
            months.map(async m => {
                const res = await this.transactionRepository.aggregateMonthlyAmount({
                    start: m.start,
                    end: m.end,
                    userId
                })
                return {
                    label: m.label,
                    amount: Number(res._sum.amount || 0)
                }
            })
        )

        return results
    }
}
