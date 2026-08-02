import { describe, expect, it, vi } from 'vitest'
import { GetEmergencyReserveStatusUseCase } from '../deep-analysis-use-case/get-emergency-reserve-status.use-case'

const PERIOD = '2026-08'
const ESSENTIAL_MONTHLY_EXPENSE = 1000

function buildMonthlySummaryUseCase(balances: number[]) {
    const execute = vi.fn()
    balances.forEach((balance) => execute.mockResolvedValueOnce({ balance }))
    return { execute } as any
}

describe('GetEmergencyReserveStatusUseCase', () => {
    it('calcula meta automática (6x essencial) e soma só contas SAVINGS/PIGGY_BANK ativas', async () => {
        const accountRepository = {
            listByUserIdWithBalance: vi.fn().mockResolvedValue([
                { type: 'SAVINGS', balance: 1000, isActive: true },
                { type: 'PIGGY_BANK', balance: 500, isActive: true },
                { type: 'CHECKING', balance: 99999, isActive: true },
                { type: 'SAVINGS', balance: 200, isActive: false },
            ]),
        } as any
        const financialGoalSettingsRepository = {
            findByUserId: vi.fn().mockResolvedValue(null),
        } as any
        const monthlySummaryUseCase = buildMonthlySummaryUseCase([200, 300, 400])

        const sut = new GetEmergencyReserveStatusUseCase(
            accountRepository,
            financialGoalSettingsRepository,
            monthlySummaryUseCase,
        )

        const result = await sut.execute('user-1', PERIOD, ESSENTIAL_MONTHLY_EXPENSE)

        expect(result.current).toBe(1500)
        expect(result.target).toBe(6000)
        expect(result.targetSource).toBe('auto')
        expect(result.missing).toBe(4500)
        expect(result.suggestedMonthly).toBe(375)
        expect(result.plannedMonthly).toBe(375)
        expect(result.monthsAtPlannedPace).toBe(12)
        expect(result.monthsAtCurrentPace).toBe(15) // média de 300/mês
        expect(result.progressPercent).toBe(25)
        expect(result.isComplete).toBe(false)
    })

    it('usa meta e aporte mensal customizados quando o usuário define overrides', async () => {
        const accountRepository = {
            listByUserIdWithBalance: vi.fn().mockResolvedValue([
                { type: 'SAVINGS', balance: 1500, isActive: true },
            ]),
        } as any
        const financialGoalSettingsRepository = {
            findByUserId: vi.fn().mockResolvedValue({
                incomeStability: 'STABLE',
                reserveTargetOverride: 10000,
                reserveMonthlyContribution: 600,
            }),
        } as any
        const monthlySummaryUseCase = buildMonthlySummaryUseCase([0, 0, 0])

        const sut = new GetEmergencyReserveStatusUseCase(
            accountRepository,
            financialGoalSettingsRepository,
            monthlySummaryUseCase,
        )

        const result = await sut.execute('user-1', PERIOD, ESSENTIAL_MONTHLY_EXPENSE)

        expect(result.target).toBe(10000)
        expect(result.targetSource).toBe('custom')
        expect(result.missing).toBe(8500)
        expect(result.plannedMonthly).toBe(600)
        expect(result.monthsAtPlannedPace).toBe(15)
        expect(result.monthsAtCurrentPace).toBeNull()
    })

    it('usa multiplicador de 9x quando a renda é variável', async () => {
        const accountRepository = { listByUserIdWithBalance: vi.fn().mockResolvedValue([]) } as any
        const financialGoalSettingsRepository = {
            findByUserId: vi.fn().mockResolvedValue({ incomeStability: 'VARIABLE' }),
        } as any
        const monthlySummaryUseCase = buildMonthlySummaryUseCase([0, 0, 0])

        const sut = new GetEmergencyReserveStatusUseCase(
            accountRepository,
            financialGoalSettingsRepository,
            monthlySummaryUseCase,
        )

        const result = await sut.execute('user-1', PERIOD, ESSENTIAL_MONTHLY_EXPENSE)

        expect(result.target).toBe(9000)
    })

    it('marca como completa quando a reserva atual já atingiu a meta', async () => {
        const accountRepository = {
            listByUserIdWithBalance: vi.fn().mockResolvedValue([{ type: 'SAVINGS', balance: 7000, isActive: true }]),
        } as any
        const financialGoalSettingsRepository = { findByUserId: vi.fn().mockResolvedValue(null) } as any
        const monthlySummaryUseCase = buildMonthlySummaryUseCase([100, 100, 100])

        const sut = new GetEmergencyReserveStatusUseCase(
            accountRepository,
            financialGoalSettingsRepository,
            monthlySummaryUseCase,
        )

        const result = await sut.execute('user-1', PERIOD, ESSENTIAL_MONTHLY_EXPENSE)

        expect(result.isComplete).toBe(true)
        expect(result.missing).toBe(0)
        expect(result.monthsAtPlannedPace).toBe(0)
        expect(result.progressPercent).toBe(100)
    })
})
