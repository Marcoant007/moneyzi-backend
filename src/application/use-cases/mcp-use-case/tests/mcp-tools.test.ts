import { describe, it, expect, vi } from 'vitest'
import { buildMcpTools } from '@/application/use-cases/mcp-use-case/mcp-tools'

function buildDeps(scope: string = 'read_write') {
    return {
        userId: 'owner-user-1',
        scope,
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
        listCategoriesUseCase: {
            execute: vi.fn().mockResolvedValue([
                { id: 'cat-1', name: 'Moradia', parentId: null, createdAt: new Date(), totalSpend: 1000, transactionCount: 5 },
            ]),
        } as any,
        createCategoryForMcpUseCase: { execute: vi.fn().mockResolvedValue({ id: 'cat-new', name: 'Nova', parentId: null, alreadyExisted: false, operationId: 'op-1' }) } as any,
        moveTransactionCategoryUseCase: { execute: vi.fn().mockResolvedValue({ id: 'tx-1', name: 'Compra', previousCategoryId: null, newCategoryId: 'cat-1', operationId: 'op-2' }) } as any,
        bulkMoveTransactionsUseCase: {
            dryRun: vi.fn().mockResolvedValue({ preview: [], count: 0, confirmationToken: 'token-1', expiresInSeconds: 600 }),
            confirm: vi.fn().mockResolvedValue({ updatedCount: 2, operationId: 'op-3', alreadyExecuted: false }),
        } as any,
        rollbackOperationUseCase: { execute: vi.fn().mockResolvedValue({ operationId: 'op-1', tool: 'create_category', rolledBack: true, skipped: [] }) } as any,
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

    it('list_categories is available and works with a read-only token', async () => {
        const deps = buildDeps('read')
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'list_categories')!

        const result = (await tool.execute({})) as any

        expect(deps.listCategoriesUseCase.execute).toHaveBeenCalledWith('owner-user-1')
        expect(result.categories).toEqual([{ id: 'cat-1', name: 'Moradia', parentId: null, transactionCount: 5 }])
    })

    it('read-only tokens do not get any write tool', () => {
        const deps = buildDeps('read')
        const tools = buildMcpTools(deps)
        const names = tools.map((t) => t.name)

        expect(names).not.toContain('create_category')
        expect(names).not.toContain('move_transaction_category')
        expect(names).not.toContain('bulk_move_transactions')
        expect(names).not.toContain('rollback_operation')
    })

    it('read_write tokens get all 5 read tools plus the 4 write tools', () => {
        const deps = buildDeps('read_write')
        const tools = buildMcpTools(deps)
        const names = tools.map((t) => t.name)

        expect(names).toEqual(expect.arrayContaining([
            'get_monthly_summary', 'list_transactions', 'get_payables_receivables', 'get_accounts',
            'get_category_totals_by_month', 'list_categories',
            'create_category', 'move_transaction_category', 'bulk_move_transactions', 'rollback_operation',
        ]))
        expect(names).toHaveLength(10)
    })

    it('create_category always uses the fixed owner userId, ignoring anything in args', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'create_category')!

        await tool.execute({ name: 'Alimentação', userId: 'someone-else' })

        expect(deps.createCategoryForMcpUseCase.execute).toHaveBeenCalledWith({
            userId: 'owner-user-1',
            name: 'Alimentação',
            parentId: null,
        })
    })

    it('move_transaction_category always uses the fixed owner userId, ignoring anything in args', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'move_transaction_category')!

        await tool.execute({ transactionId: 'tx-1', newCategoryId: 'cat-1', userId: 'someone-else' })

        expect(deps.moveTransactionCategoryUseCase.execute).toHaveBeenCalledWith({
            userId: 'owner-user-1',
            transactionId: 'tx-1',
            newCategoryId: 'cat-1',
        })
    })

    it('bulk_move_transactions defaults to dryRun and never touches confirm', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'bulk_move_transactions')!

        await tool.execute({ newCategoryId: 'cat-1', filter: { nameContains: 'uber' } })

        expect(deps.bulkMoveTransactionsUseCase.dryRun).toHaveBeenCalledWith(
            'owner-user-1',
            { transactionIds: undefined, filter: { nameContains: 'uber' } },
            'cat-1',
        )
        expect(deps.bulkMoveTransactionsUseCase.confirm).not.toHaveBeenCalled()
    })

    it('bulk_move_transactions rejects dryRun:false without a confirmationToken', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'bulk_move_transactions')!

        await expect(tool.execute({ newCategoryId: 'cat-1', dryRun: false })).rejects.toThrow(/confirmationToken/)
        expect(deps.bulkMoveTransactionsUseCase.confirm).not.toHaveBeenCalled()
    })

    it('bulk_move_transactions calls confirm when dryRun:false with a confirmationToken', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'bulk_move_transactions')!

        await tool.execute({ newCategoryId: 'cat-1', dryRun: false, confirmationToken: 'token-1', transactionIds: ['tx-1', 'tx-2'] })

        expect(deps.bulkMoveTransactionsUseCase.confirm).toHaveBeenCalledWith(
            'owner-user-1',
            'token-1',
            { transactionIds: ['tx-1', 'tx-2'], filter: undefined },
            'cat-1',
        )
    })

    it('rollback_operation always uses the fixed owner userId', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'rollback_operation')!

        await tool.execute({ operationId: 'op-1', userId: 'someone-else' })

        expect(deps.rollbackOperationUseCase.execute).toHaveBeenCalledWith('owner-user-1', 'op-1')
    })
})
