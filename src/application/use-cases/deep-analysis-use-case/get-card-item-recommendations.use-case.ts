import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { MoneyUtils } from '@/utils/money.utils'
import { PeriodUtils } from '@/utils/period.utils'
import type { TransactionCategory } from '@prisma/client'

export type CardItemRecommendation = {
    merchant: string
    actual: number
    baseline: number | null
    ideal: number
    reducible: number
}

const HISTORY_MONTHS = 3
const BASELINE_SLACK_MULTIPLIER = 1.1
const MIN_RELEVANT_AMOUNT = 50
const MIN_RELEVANT_INCOME_PERCENT = 0.005

const CATEGORY_CEILING_PERCENT: Partial<Record<TransactionCategory, number>> = {
    FOOD_DELIVERY: 0.05,
    TRANSPORTATION: 0.04,
    ENTERTAINMENT: 0.03,
    STREAMING: 0.02,
    GAMING: 0.02,
    FOOD: 0.06,
    SIGNATURE: 0.02,
    SERVICES: 0.03,
}
const DEFAULT_CEILING_PERCENT = 0.04

export class GetCardItemRecommendationsUseCase {
    constructor(private readonly transactionRepository: TransactionRepository) { }

    async execute(userId: string, period: string, income: number): Promise<CardItemRecommendation[]> {
        const currentGroups = await this.groupCardExpensesByMerchant(userId, period)

        if (currentGroups.size === 0) return []

        const priorPeriods = PeriodUtils.lastNPeriods(period, HISTORY_MONTHS)
        const priorGroupsByPeriod = await Promise.all(
            priorPeriods.map((priorPeriod) => this.groupCardExpensesByMerchant(userId, priorPeriod)),
        )

        const recommendations: CardItemRecommendation[] = []

        for (const [merchant, entry] of currentGroups) {
            const baseline = this.computeBaseline(merchant, priorGroupsByPeriod)
            const ideal = baseline !== null
                ? MoneyUtils.round(baseline * BASELINE_SLACK_MULTIPLIER)
                : this.categoryFallbackCeiling(entry.category, income)

            const reducible = MoneyUtils.round(Math.max(0, entry.total - ideal))

            if (!this.isRelevant(reducible, income)) continue

            recommendations.push({
                merchant,
                actual: entry.total,
                baseline,
                ideal,
                reducible,
            })
        }

        return recommendations.sort((a, b) => b.reducible - a.reducible)
    }

    private async groupCardExpensesByMerchant(
        userId: string,
        period: string,
    ): Promise<Map<string, { total: number; category: TransactionCategory }>> {
        const range = PeriodUtils.parseMonthRange(period)
        const transactions = await this.transactionRepository.findDashboardTransactions(userId, range)

        const groups = new Map<string, { total: number; category: TransactionCategory }>()

        for (const transaction of transactions) {
            if (transaction.type !== 'EXPENSE' || transaction.paymentMethod !== 'CREDIT_CARD') continue

            const merchant = this.normalizeMerchant(transaction.name)
            if (!merchant) continue

            const amount = MoneyUtils.round(Number(transaction.amount || 0))
            const current = groups.get(merchant)

            groups.set(merchant, {
                total: MoneyUtils.add(current?.total ?? 0, amount),
                category: current?.category ?? transaction.category,
            })
        }

        return groups
    }

    private computeBaseline(
        merchant: string,
        priorGroupsByPeriod: Array<Map<string, { total: number; category: TransactionCategory }>>,
    ): number | null {
        const hasHistory = priorGroupsByPeriod.some((group) => group.has(merchant))
        if (!hasHistory) return null

        const totals = priorGroupsByPeriod.map((group) => group.get(merchant)?.total ?? 0)
        return MoneyUtils.round(MoneyUtils.sum(totals) / HISTORY_MONTHS)
    }

    private categoryFallbackCeiling(category: TransactionCategory, income: number): number {
        const percent = CATEGORY_CEILING_PERCENT[category] ?? DEFAULT_CEILING_PERCENT
        return MoneyUtils.round(Math.max(0, income) * percent)
    }

    private isRelevant(reducible: number, income: number): boolean {
        if (reducible <= 0) return false
        if (reducible >= MIN_RELEVANT_AMOUNT) return true
        if (income <= 0) return false
        return reducible / income >= MIN_RELEVANT_INCOME_PERCENT
    }

    private normalizeMerchant(rawName: string): string {
        return rawName
            .toUpperCase()
            .replace(/\s*-?\s*PARCELA\s*\d+\s*\/\s*\d+/gi, '')
            .replace(/\s+\d+\s*\/\s*\d+\s*$/g, '')
            .trim()
    }
}
