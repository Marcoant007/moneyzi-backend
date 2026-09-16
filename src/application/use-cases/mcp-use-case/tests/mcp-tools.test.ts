import { describe, it, expect, vi } from 'vitest'
import { buildMcpTools } from '@/application/use-cases/mcp-use-case/mcp-tools'

function buildDeps() {
    return {
        userId: 'owner-user-1',
        getMonthlySummaryUseCase: { execute: vi.fn().mockResolvedValue({ income: 100 }) } as any,
        listTransactionsUseCase: { execute: vi.fn().mockResolvedValue([]) } as any,
        getPayablesReceivablesUseCase: { execute: vi.fn().mockResolvedValue({ payables: {} }) } as any,
        listAccountsUseCase: { execute: vi.fn().mockResolvedValue({ totalBalance: 0, accounts: [] }) } as any,
        getCategoryMonthMatrixUseCase: {
            execute: vi.fn().mockResolvedValue({
                months: ['2026-01', '2026-02'],
                income: { rows: [], subtotal: [0, 0] },
                expense: {
                    rows: [
                        { id: 'cat-1', name: 'Moradia', depth: 1, monthlyTotals: [1000, 1100] },
                        { id: 'legacy-expense', name: '', depth: 1, isLegacy: true, monthlyTotals: [10, 20] },
                    ],
                    subtotal: [1010, 1120],
                },
                balance: [500, 400],
            }),
        } as any,
    }
}

describe('buildMcpTools', () => {
    it('get_monthly_summary always uses the fixed owner userId, ignoring anything in args', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'get_monthly_summary')!

        await tool.execute({ period: '2026-03', userId: 'someone-else' })

        expect(deps.getMonthlySummaryUseCase.execute).toHaveBeenCalledWith('owner-user-1', '2026-03')
    })

    it('list_transactions always uses the fixed owner userId, ignoring anything in args', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'list_transactions')!

        await tool.execute({ month: 3, year: 2026, userId: 'someone-else' })

        expect(deps.listTransactionsUseCase.execute).toHaveBeenCalledWith({
            userId: 'owner-user-1',
            month: 3,
            year: 2026,
            accountId: undefined,
        })
    })

    it('get_payables_receivables always uses the fixed owner userId, ignoring anything in args', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'get_payables_receivables')!

        await tool.execute({ month: 3, year: 2026, userId: 'someone-else' })

        expect(deps.getPayablesReceivablesUseCase.execute).toHaveBeenCalledWith({
            userId: 'owner-user-1',
            month: 3,
            year: 2026,
        })
    })

    it('get_accounts always uses the fixed owner userId', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'get_accounts')!

        await tool.execute({ userId: 'someone-else' })

        expect(deps.listAccountsUseCase.execute).toHaveBeenCalledWith('owner-user-1')
    })

    it('get_category_totals_by_month always uses the fixed owner userId and reshapes rows into byMonth, dropping legacy rows', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'get_category_totals_by_month')!

        const result = (await tool.execute({ year: 2026, userId: 'someone-else' })) as any

        expect(deps.getCategoryMonthMatrixUseCase.execute).toHaveBeenCalledWith({
            userId: 'owner-user-1',
            year: 2026,
        })
        expect(result.months).toEqual(['2026-01', '2026-02'])
        expect(result.monthlyBalance).toEqual({ '2026-01': 500, '2026-02': 400 })
        expect(result.expenseByCategory).toEqual([
            { category: 'Moradia', depth: 1, byMonth: { '2026-01': 1000, '2026-02': 1100 } },
        ])
        expect(result.incomeByCategory).toEqual([])
    })

    it('falls back to the current month/year when list_transactions args are empty', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'list_transactions')!

        await tool.execute({})

        const now = new Date()
        expect(deps.listTransactionsUseCase.execute).toHaveBeenCalledWith({
            userId: 'owner-user-1',
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            accountId: undefined,
        })
    })
})
