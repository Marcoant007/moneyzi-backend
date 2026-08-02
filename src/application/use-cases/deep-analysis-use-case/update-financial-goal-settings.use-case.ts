import type { FinancialGoalSettingsRepository } from '@/application/repositories/financial-goal-settings-repository'
import type { FinancialGoalSettingsOutput } from '@/application/use-cases/deep-analysis-use-case/get-financial-goal-settings.use-case'
import type { IncomeStability } from '@prisma/client'

export type UpdateFinancialGoalSettingsInput = {
    incomeStability?: IncomeStability
    reserveTargetOverride?: number | null
    reserveMonthlyContribution?: number | null
}

export class UpdateFinancialGoalSettingsUseCase {
    constructor(private readonly financialGoalSettingsRepository: FinancialGoalSettingsRepository) { }

    async execute(userId: string, input: UpdateFinancialGoalSettingsInput): Promise<FinancialGoalSettingsOutput> {
        if (input.reserveTargetOverride !== undefined && input.reserveTargetOverride !== null && input.reserveTargetOverride < 0) {
            throw new Error('reserveTargetOverride não pode ser negativo')
        }

        if (
            input.reserveMonthlyContribution !== undefined &&
            input.reserveMonthlyContribution !== null &&
            input.reserveMonthlyContribution < 0
        ) {
            throw new Error('reserveMonthlyContribution não pode ser negativo')
        }

        const settings = await this.financialGoalSettingsRepository.upsert({
            userId,
            incomeStability: input.incomeStability,
            reserveTargetOverride: input.reserveTargetOverride,
            reserveMonthlyContribution: input.reserveMonthlyContribution,
        })

        return {
            incomeStability: settings.incomeStability,
            reserveTargetOverride: settings.reserveTargetOverride ? Number(settings.reserveTargetOverride) : null,
            reserveMonthlyContribution: settings.reserveMonthlyContribution
                ? Number(settings.reserveMonthlyContribution)
                : null,
        }
    }
}
