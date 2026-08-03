import { createHash } from 'node:crypto'
import type { MonthlySummaryOutput } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import type { CardItemRecommendation } from './get-card-item-recommendations.use-case'
import type { EmergencyReserveStatus } from './get-emergency-reserve-status.use-case'

export type DeepAnalysisInput = {
    period: string
    income: number
    expenses: number
    balance: number
    commitmentRate: number
    fixedExpenses: MonthlySummaryOutput['fixedExpenses']
    variableExpenses: MonthlySummaryOutput['variableExpenses']
    creditCardAnalysis: MonthlySummaryOutput['creditCardAnalysis'] & {
        recommendedCeiling: number
        isOverCeiling: boolean
        itemRecommendations: CardItemRecommendation[]
    }
    topOffenders: MonthlySummaryOutput['topOffenders']
    rule503020: MonthlySummaryOutput['rule503020']
    healthScore: MonthlySummaryOutput['healthScore']
    emergencyReserve: EmergencyReserveStatus
}

export type DeepAnalysisBucketStatus = 'good' | 'warning' | 'bad'

export type DeepAnalysisOutput = {
    summary: string
    fixedHealth: { status: DeepAnalysisBucketStatus; message: string }
    cardAnalysis: { status: DeepAnalysisBucketStatus; message: string }
    topOffenderAdvice: string
    rule503020Message: string
    reserveMessage: string
    actionPlan: [string, string, string]
}

export type DeepAnalysisRecord = DeepAnalysisOutput & {
    stale: boolean
    generatedAt: string
    model: string
    regeneratedCount: number
}

/**
 * Hash só dos campos que, se mudarem, tornam a análise salva desatualizada.
 * Valores arredondados pra centavos de diferença não disparar "stale" à toa.
 */
export function buildInputHash(input: DeepAnalysisInput): string {
    const relevant = {
        income: Math.round(input.income),
        expenses: Math.round(input.expenses),
        fixedTotal: Math.round(input.fixedExpenses.total),
        variableTotal: Math.round(input.variableExpenses.total),
        creditCardTotal: Math.round(input.creditCardAnalysis.total),
        topOffenders: input.topOffenders.map((offender) => `${offender.category}:${Math.round(offender.total)}`),
        reserveCurrent: Math.round(input.emergencyReserve.current),
        reserveTarget: Math.round(input.emergencyReserve.target),
    }

    return createHash('sha256').update(JSON.stringify(relevant)).digest('hex')
}
