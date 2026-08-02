import type { FinancialGoalSettingsRepository } from '@/application/repositories/financial-goal-settings-repository'
import type { IncomeStability } from '@prisma/client'

export type FinancialGoalSettingsOutput = {
    incomeStability: IncomeStability
    reserveTargetOverride: number | null
    reserveMonthlyContribution: number | null
}

export class GetFinancialGoalSettingsUseCase {
    constructor(private readonly financialGoalSettingsRepository: FinancialGoalSettingsRepository) { }

    async execute(userId: string): Promise<FinancialGoalSettingsOutput> {
        const settings = await this.financialGoalSettingsRepository.findByUserId(userId)

        return {
            incomeStability: settings?.incomeStability ?? 'STABLE',
            reserveTargetOverride: settings?.reserveTargetOverride ? Number(settings.reserveTargetOverride) : null,
            reserveMonthlyContribution: settings?.reserveMonthlyContribution
                ? Number(settings.reserveMonthlyContribution)
                : null,
        }
    }
}
