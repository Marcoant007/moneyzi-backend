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
        listSystemCategoriesUseCase: {
            execute: vi.fn().mockResolvedValue([
                { id: 'system:SERVICES', name: 'SERVICES', parentId: null, transactionCount: 3, isSystem: true },
                { id: 'system:OTHER', name: 'OTHER', parentId: null, transactionCount: 0, isSystem: true },
            ]),
        } as any,
        mergeCategoriesUseCase: {
            dryRun: vi.fn().mockResolvedValue({ canExecute: true, confirmationToken: 'merge-token-1' }),
            confirm: vi.fn().mockResolvedValue({ operationId: 'op-merge', alreadyExecuted: false }),
        } as any,
        renameCategoryForMcpUseCase: { execute: vi.fn().mockResolvedValue({ id: 'cat-1', changed: true, operationId: 'op-rename' }) } as any,
        moveCategoryForMcpUseCase: { execute: vi.fn().mockResolvedValue({ id: 'cat-1', changed: true, operationId: 'op-move' }) } as any,
        deleteCategoryForMcpUseCase: { execute: vi.fn().mockResolvedValue({ deletedCategoryId: 'cat-1', operationId: 'op-delete' }) } as any,
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
        expect(deps.listSystemCategoriesUseCase.execute).toHaveBeenCalledWith('owner-user-1')
        // Contrato antigo: as categorias personalizadas continuam com os mesmos campos e valores.
        expect(result.categories[0]).toMatchObject({ id: 'cat-1', name: 'Moradia', parentId: null, transactionCount: 5 })
    })

    it('list_categories flags custom categories isSystem:false and appends the system ones with a stable id', async () => {
        const deps = buildDeps('read')
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'list_categories')!

        const result = (await tool.execute({})) as any

        expect(result.categories).toEqual([
            { id: 'cat-1', name: 'Moradia', parentId: null, transactionCount: 5, isSystem: false },
            { id: 'system:SERVICES', name: 'SERVICES', parentId: null, transactionCount: 3, isSystem: true },
            { id: 'system:OTHER', name: 'OTHER', parentId: null, transactionCount: 0, isSystem: true },
        ])
    })

    it('list_transactions keeps every old field and adds id + categoryId (custom id, or the system id when there is no custom category)', async () => {
        const deps = buildDeps('read')
        deps.listTransactionsUseCase.execute.mockResolvedValue([
            {
                id: 'tx-1', name: 'Aluguel', type: 'EXPENSE', amount: 1500, category: 'HOUSING',
                categoryId: 'cat-1', categoryRef: { id: 'cat-1', name: 'Moradia' },
                date: new Date('2026-03-05'), paymentMethod: 'PIX', account: { id: 'acc-1', name: 'Nubank' },
            },
            {
                id: 'tx-2', name: 'Faxina', type: 'EXPENSE', amount: 200, category: 'SERVICES',
                categoryId: null, categoryRef: null,
                date: new Date('2026-03-06'), paymentMethod: 'CASH', account: null,
            },
        ])
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'list_transactions')!

        const result = (await tool.execute({ month: 3, year: 2026 })) as any[]

        expect(result[0]).toEqual({
            id: 'tx-1', name: 'Aluguel', type: 'EXPENSE', amount: 1500, category: 'Moradia', categoryId: 'cat-1',
            date: new Date('2026-03-05'), paymentMethod: 'PIX', account: 'Nubank',
        })
        expect(result[1]).toEqual({
            id: 'tx-2', name: 'Faxina', type: 'EXPENSE', amount: 200, category: 'SERVICES', categoryId: 'system:SERVICES',
            date: new Date('2026-03-06'), paymentMethod: 'CASH', account: null,
        })
    })

    const NEW_STRUCTURE_TOOLS = ['merge_categories', 'rename_category', 'move_category', 'delete_category']

    it('read-only tokens do not get any write tool', () => {
        const deps = buildDeps('read')
        const tools = buildMcpTools(deps)
        const names = tools.map((t) => t.name)

        expect(names).not.toContain('create_category')
        expect(names).not.toContain('move_transaction_category')
        expect(names).not.toContain('bulk_move_transactions')
        expect(names).not.toContain('rollback_operation')
        for (const name of NEW_STRUCTURE_TOOLS) {
            expect(names).not.toContain(name)
        }
        expect(names).toHaveLength(6)
    })

    it('read_write tokens get all 6 read tools plus the 8 write tools', () => {
        const deps = buildDeps('read_write')
        const tools = buildMcpTools(deps)
        const names = tools.map((t) => t.name)

        expect(names).toEqual(expect.arrayContaining([
            'get_monthly_summary', 'list_transactions', 'get_payables_receivables', 'get_accounts',
            'get_category_totals_by_month', 'list_categories',
            'create_category', 'move_transaction_category', 'bulk_move_transactions', 'rollback_operation',
            ...NEW_STRUCTURE_TOOLS,
        ]))
        expect(names).toHaveLength(14)
    })

    it('the two-call tools say so explicitly in their pt-BR description', () => {
        const tools = buildMcpTools(buildDeps('read_write'))

        for (const name of ['bulk_move_transactions', 'merge_categories']) {
            const description = tools.find((t) => t.name === name)!.description
            expect(description).toContain('ESTA FERRAMENTA EXIGE DUAS CHAMADAS')
        }
        for (const name of ['rename_category', 'move_category', 'delete_category']) {
            expect(tools.find((t) => t.name === name)!.description).not.toContain('EXIGE DUAS CHAMADAS')
        }
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

    it('bulk_move_transactions passes the new filter fields through untouched', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'bulk_move_transactions')!

        const filter = {
            nameContainsAny: ['iptu', 'seguro'],
            currentCategoryId: 'system:SERVICES',
            paymentMethod: 'BANK_SLIP',
            type: 'EXPENSE',
            amountMin: 10,
            amountMax: 500,
        }
        await tool.execute({ newCategoryId: 'cat-1', filter })

        expect(deps.bulkMoveTransactionsUseCase.dryRun).toHaveBeenCalledWith(
            'owner-user-1',
            { transactionIds: undefined, filter },
            'cat-1',
        )
    })

    it('bulk_move_transactions input schema rejects an empty nameContainsAny and an INVESTMENT type', () => {
        const tools = buildMcpTools(buildDeps())
        const tool = tools.find((t) => t.name === 'bulk_move_transactions')!
        const filterSchema = (tool.inputSchema as any).filter

        expect(filterSchema.safeParse({ nameContainsAny: [] }).success).toBe(false)
        expect(filterSchema.safeParse({ type: 'INVESTMENT' }).success).toBe(false)
        expect(filterSchema.safeParse({ paymentMethod: 'NOT_A_METHOD' }).success).toBe(false)
        expect(filterSchema.safeParse({ nameContainsAny: ['a'], type: 'DEPOSIT', paymentMethod: 'PIX' }).success).toBe(true)
    })

    it('merge_categories defaults to dryRun and never touches confirm', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'merge_categories')!

        await tool.execute({ sourceId: 'cat-a', targetId: 'cat-b', userId: 'someone-else' })

        expect(deps.mergeCategoriesUseCase.dryRun).toHaveBeenCalledWith('owner-user-1', 'cat-a', 'cat-b')
        expect(deps.mergeCategoriesUseCase.confirm).not.toHaveBeenCalled()
    })

    it('merge_categories rejects dryRun:false without a confirmationToken', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'merge_categories')!

        await expect(tool.execute({ sourceId: 'cat-a', targetId: 'cat-b', dryRun: false })).rejects.toThrow(/confirmationToken/)
        expect(deps.mergeCategoriesUseCase.confirm).not.toHaveBeenCalled()
    })

    it('merge_categories calls confirm when dryRun:false with a confirmationToken', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'merge_categories')!

        await tool.execute({ sourceId: 'cat-a', targetId: 'cat-b', dryRun: false, confirmationToken: 'merge-token-1' })

        expect(deps.mergeCategoriesUseCase.confirm).toHaveBeenCalledWith('owner-user-1', 'merge-token-1', 'cat-a', 'cat-b')
    })

    it('rename_category, move_category and delete_category always use the owner userId, ignoring anything in args', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)

        await tools.find((t) => t.name === 'rename_category')!.execute({ categoryId: 'cat-1', newName: 'Novo', userId: 'someone-else' })
        await tools.find((t) => t.name === 'move_category')!.execute({ categoryId: 'cat-1', newParentId: 'cat-2', userId: 'someone-else' })
        await tools.find((t) => t.name === 'delete_category')!.execute({ categoryId: 'cat-1', userId: 'someone-else' })

        expect(deps.renameCategoryForMcpUseCase.execute).toHaveBeenCalledWith({ userId: 'owner-user-1', categoryId: 'cat-1', newName: 'Novo' })
        expect(deps.moveCategoryForMcpUseCase.execute).toHaveBeenCalledWith({ userId: 'owner-user-1', categoryId: 'cat-1', newParentId: 'cat-2' })
        expect(deps.deleteCategoryForMcpUseCase.execute).toHaveBeenCalledWith({ userId: 'owner-user-1', categoryId: 'cat-1' })
    })

    it('move_category accepts an explicit null parent (root) but requires the field to be present', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'move_category')!

        await tool.execute({ categoryId: 'cat-1', newParentId: null })
        expect(deps.moveCategoryForMcpUseCase.execute).toHaveBeenCalledWith({ userId: 'owner-user-1', categoryId: 'cat-1', newParentId: null })

        // omitir newParentId NÃO pode virar "mover pra raiz" por acidente
        await expect(tool.execute({ categoryId: 'cat-1' })).rejects.toThrow()
    })

    it('rollback_operation always uses the fixed owner userId', async () => {
        const deps = buildDeps()
        const tools = buildMcpTools(deps)
        const tool = tools.find((t) => t.name === 'rollback_operation')!

        await tool.execute({ operationId: 'op-1', userId: 'someone-else' })

        expect(deps.rollbackOperationUseCase.execute).toHaveBeenCalledWith('owner-user-1', 'op-1')
    })

    it('rollback_operation lists every reversible tool in its description', () => {
        const tools = buildMcpTools(buildDeps())
        const description = tools.find((t) => t.name === 'rollback_operation')!.description

        for (const name of ['create_category', 'move_transaction_category', 'bulk_move_transactions', ...NEW_STRUCTURE_TOOLS]) {
            expect(description).toContain(name)
        }
    })
})
