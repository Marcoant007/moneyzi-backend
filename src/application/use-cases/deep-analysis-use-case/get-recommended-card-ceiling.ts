import { MoneyUtils } from '@/utils/money.utils'

const CEILING_INCOME_PERCENT = 0.3
const CEILING_FREE_BUDGET_PERCENT = 0.6

/**
 * Teto de gasto no cartão recomendado pro mês: o menor entre
 * 30% da renda e 60% do orçamento livre após o essencial.
 */
export function getRecommendedCardCeiling(income: number, essentialSpend: number): number {
    const byIncome = income * CEILING_INCOME_PERCENT
    const byFreeBudget = (income - essentialSpend) * CEILING_FREE_BUDGET_PERCENT

    return MoneyUtils.round(Math.max(0, Math.min(byIncome, byFreeBudget)))
}
