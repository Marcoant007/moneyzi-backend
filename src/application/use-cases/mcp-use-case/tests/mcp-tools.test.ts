import { describe, it, expect, vi } from 'vitest'
import { buildMcpTools } from '@/application/use-cases/mcp-use-case/mcp-tools'

function buildDeps() {
    return {
        userId: 'owner-user-1',
        getMonthlySummaryUseCase: { execute: vi.fn().mockResolvedValue({ income: 100 }) } as any,
        listTransactionsUseCase: { execute: vi.fn().mockResolvedValue([]) } as any,
        getPayablesReceivablesUseCase: { execute: vi.fn().mockResolvedValue({ payables: {} }) } as any,
        listAccountsUseCase: { execute: vi.fn().mockResolvedValue({ totalBalance: 0, accounts: [] }) } as any,
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
