import type { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import type { GetCardItemRecommendationsUseCase } from './get-card-item-recommendations.use-case'
import type { GetEmergencyReserveStatusUseCase } from './get-emergency-reserve-status.use-case'
import { getRecommendedCardCeiling } from './get-recommended-card-ceiling'
import type { DeepAnalysisInput } from './deep-analysis.types'

/**
 * Monta o snapshot determinístico usado tanto pra decidir se o cache está
 * desatualizado quanto pra virar o prompt da IA. Nenhum token gasto aqui.
 */
export class BuildDeepAnalysisSnapshotUseCase {
    constructor(
        private readonly monthlySummaryUseCase: GetMonthlySummaryUseCase,
        private readonly cardItemRecommendationsUseCase: GetCardItemRecommendationsUseCase,
        private readonly emergencyReserveStatusUseCase: GetEmergencyReserveStatusUseCase,
    ) { }

    async execute(userId: string, period: string): Promise<DeepAnalysisInput> {
        const summary = await this.monthlySummaryUseCase.execute(userId, period)

        const [itemRecommendations, emergencyReserve] = await Promise.all([
            this.cardItemRecommendationsUseCase.execute(userId, period, summary.income),
            this.emergencyReserveStatusUseCase.execute(userId, period, summary.fixedExpenses.total),
        ])

        const recommendedCeiling = getRecommendedCardCeiling(summary.income, summary.fixedExpenses.total)

        return {
            period,
            income: summary.income,
            expenses: summary.expenses,
            balance: summary.balance,
            commitmentRate: summary.commitmentRate,
            fixedExpenses: summary.fixedExpenses,
            variableExpenses: summary.variableExpenses,
            creditCardAnalysis: {
                ...summary.creditCardAnalysis,
                recommendedCeiling,
                isOverCeiling: summary.creditCardAnalysis.total > recommendedCeiling,
                itemRecommendations,
            },
            topOffenders: summary.topOffenders,
            rule503020: summary.rule503020,
            healthScore: summary.healthScore,
            emergencyReserve,
        }
    }
}
