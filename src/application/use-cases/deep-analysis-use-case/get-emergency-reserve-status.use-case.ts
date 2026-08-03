import type { AccountRepository, AccountWithBalance } from '@/application/repositories/account-repository'
import type { FinancialGoalSettingsRepository } from '@/application/repositories/financial-goal-settings-repository'
import type { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { MoneyUtils } from '@/utils/money.utils'
import { PeriodUtils } from '@/utils/period.utils'

export type EmergencyReserveStatus = {
    current: number
    target: number
    targetSource: 'auto' | 'custom'
    progressPercent: number
    missing: number
    suggestedMonthly: number
    plannedMonthly: number
    monthsAtPlannedPace: number | null
    monthsAtCurrentPace: number | null
    isComplete: boolean
}

const STABLE_INCOME_MULTIPLIER = 6
const VARIABLE_INCOME_MULTIPLIER = 9
const SUGGESTED_MONTHS_TO_GOAL = 12
const SAVINGS_HISTORY_MONTHS = 3

export class GetEmergencyReserveStatusUseCase {
    constructor(
        private readonly accountRepository: AccountRepository,
        private readonly financialGoalSettingsRepository: FinancialGoalSettingsRepository,
        private readonly monthlySummaryUseCase: GetMonthlySummaryUseCase,
    ) { }

    async execute(userId: string, period: string, essentialMonthlyExpense: number): Promise<EmergencyReserveStatus> {
        const [accounts, settings, avgMonthlySavingsLast3m] = await Promise.all([
            this.accountRepository.listByUserIdWithBalance(userId),
            this.financialGoalSettingsRepository.findByUserId(userId),
            this.computeAvgMonthlySavings(userId, period),
        ])

        const current = this.currentReserve(accounts)

        const incomeStability = settings?.incomeStability ?? 'STABLE'
        const multiplier = incomeStability === 'VARIABLE' ? VARIABLE_INCOME_MULTIPLIER : STABLE_INCOME_MULTIPLIER
        const autoTarget = MoneyUtils.round(Math.max(0, essentialMonthlyExpense) * multiplier)

        const targetOverride = settings?.reserveTargetOverride !== null && settings?.reserveTargetOverride !== undefined
            ? Number(settings.reserveTargetOverride)
            : null
        const target = targetOverride ?? autoTarget
        const targetSource: 'auto' | 'custom' = targetOverride !== null ? 'custom' : 'auto'

        const missing = MoneyUtils.round(Math.max(0, target - current))
        const suggestedMonthly = MoneyUtils.round(missing / SUGGESTED_MONTHS_TO_GOAL)

        const plannedMonthlyOverride = settings?.reserveMonthlyContribution !== null && settings?.reserveMonthlyContribution !== undefined
            ? Number(settings.reserveMonthlyContribution)
            : null
        const plannedMonthly = plannedMonthlyOverride ?? suggestedMonthly

        const monthsAtPlannedPace = missing <= 0
            ? 0
            : plannedMonthly > 0 ? Math.ceil(missing / plannedMonthly) : null
        const monthsAtCurrentPace = missing <= 0
            ? 0
            : avgMonthlySavingsLast3m > 0 ? Math.ceil(missing / avgMonthlySavingsLast3m) : null

        return {
            current,
            target,
            targetSource,
            progressPercent: target > 0 ? Math.min(100, Number(((current / target) * 100).toFixed(1))) : 100,
            missing,
            suggestedMonthly,
            plannedMonthly,
            monthsAtPlannedPace,
            monthsAtCurrentPace,
            isComplete: current >= target,
        }
    }

    private currentReserve(accounts: AccountWithBalance[]): number {
        const reserveAccounts = accounts.filter(
            (account) => account.isActive && (account.type === 'SAVINGS' || account.type === 'PIGGY_BANK'),
        )

        return MoneyUtils.round(MoneyUtils.sum(reserveAccounts.map((account) => account.balance)))
    }

    private async computeAvgMonthlySavings(userId: string, period: string): Promise<number> {
        const priorPeriods = PeriodUtils.lastNPeriods(period, SAVINGS_HISTORY_MONTHS)
        const summaries = await Promise.all(
            priorPeriods.map((priorPeriod) => this.monthlySummaryUseCase.execute(userId, priorPeriod)),
        )

        const positiveBalances = summaries.map((summary) => Math.max(0, summary.balance))
        return MoneyUtils.round(MoneyUtils.sum(positiveBalances) / SAVINGS_HISTORY_MONTHS)
    }
}
