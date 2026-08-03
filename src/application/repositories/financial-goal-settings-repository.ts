import type { FinancialGoalSettings, IncomeStability } from '@prisma/client'

export interface UpsertFinancialGoalSettingsData {
    userId: string
    incomeStability?: IncomeStability
    reserveTargetOverride?: number | null
    reserveMonthlyContribution?: number | null
    completeOnboarding?: boolean
}

export interface FinancialGoalSettingsRepository {
    findByUserId(userId: string): Promise<FinancialGoalSettings | null>
    upsert(data: UpsertFinancialGoalSettingsData): Promise<FinancialGoalSettings>
}
