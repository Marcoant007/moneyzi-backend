import type { FinancialGoalSettings } from '@prisma/client'
import type {
    FinancialGoalSettingsRepository,
    UpsertFinancialGoalSettingsData,
} from '@/application/repositories/financial-goal-settings-repository'
import { prisma } from '@/lib/prisma'

export class PrismaFinancialGoalSettingsRepository implements FinancialGoalSettingsRepository {
    async findByUserId(userId: string): Promise<FinancialGoalSettings | null> {
        return prisma.financialGoalSettings.findUnique({
            where: { userId },
        })
    }

    async upsert(data: UpsertFinancialGoalSettingsData): Promise<FinancialGoalSettings> {
        const { userId, incomeStability, reserveTargetOverride, reserveMonthlyContribution } = data

        return prisma.financialGoalSettings.upsert({
            where: { userId },
            create: {
                userId,
                incomeStability: incomeStability ?? 'STABLE',
                reserveTargetOverride: reserveTargetOverride ?? null,
                reserveMonthlyContribution: reserveMonthlyContribution ?? null,
            },
            update: {
                ...(incomeStability !== undefined ? { incomeStability } : {}),
                ...(reserveTargetOverride !== undefined ? { reserveTargetOverride } : {}),
                ...(reserveMonthlyContribution !== undefined ? { reserveMonthlyContribution } : {}),
            },
        })
    }
}
