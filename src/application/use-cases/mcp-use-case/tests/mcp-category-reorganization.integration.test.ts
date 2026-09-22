import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { buildMcpTools, type McpToolDefinition } from '../mcp-tools'
import { buildMcpServer } from '../build-mcp-server'
import { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'
import { ListCategoriesUseCase } from '@/application/use-cases/category-use-case/list-categories.use-case'
import { ListSystemCategoriesUseCase } from '@/application/use-cases/category-use-case/list-system-categories.use-case'
import { CreateCategoryUseCase } from '@/application/use-cases/category-use-case/create-category.use-case'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'
import { CreateCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/create-category-for-mcp.use-case'
import { MoveTransactionCategoryUseCase } from '@/application/use-cases/mcp-write-use-case/move-transaction-category.use-case'
import { BulkMoveTransactionsUseCase } from '@/application/use-cases/mcp-write-use-case/bulk-move-transactions.use-case'
import { MergeCategoriesUseCase } from '@/application/use-cases/mcp-write-use-case/merge-categories.use-case'
import { RenameCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/rename-category-for-mcp.use-case'
import { MoveCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/move-category-for-mcp.use-case'
import { DeleteCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/delete-category-for-mcp.use-case'
import { CategoryStructureRollback } from '@/application/use-cases/mcp-write-use-case/category-structure-rollback'
import { RollbackOperationUseCase } from '@/application/use-cases/mcp-write-use-case/rollback-operation.use-case'
import {
    InMemoryAuditRepository,
    InMemoryCategoryRepository,
    InMemoryCategoryUnitOfWork,
    InMemoryWorld,
    createInMemoryTransactionRepository,
} from '@/application/use-cases/mcp-write-use-case/tests/helpers/in-memory-category-world'

/**
 * Integração no nível das tools MCP: os use cases REAIS de ponta a ponta, sobre
 * um "banco" em memória que emula o Postgres (FK ON DELETE SET NULL, unique de
 * irmãs, transação com rollback). Só a camada SQL do Prisma fica de fora — essa é
 * coberta pelos testes de repositório e pela suíte opt-in contra Postgres real.
 */

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('@/infra/cache/redis', () => ({
    redis: {
        set: vi.fn(async (key: string, value: string) => {
            store.set(key, value)
            return 'OK'
        }),
        get: vi.fn(async (key: string) => store.get(key) ?? null),
    },
}))

const USER_A = 'user-a'
const USER_B = 'user-b'

function buildTools(world: InMemoryWorld, userId: string, scope: string = 'read_write'): McpToolDefinition[] {
    const categoryRepository = new InMemoryCategoryRepository(world)
    const transactionRepository = createInMemoryTransactionRepository(world)
    const auditRepository = new InMemoryAuditRepository(world)
    const unitOfWork = new InMemoryCategoryUnitOfWork(world)
    const updateMultiple = new UpdateMultipleTransactionsUseCase(transactionRepository)
    const unused = { execute: vi.fn() } as any

    return buildMcpTools({
        userId,
        scope,
        getMonthlySummaryUseCase: unused,
        getPayablesReceivablesUseCase: unused,
        listAccountsUseCase: unused,
        getCategoryMonthMatrixUseCase: unused,
        listTransactionsUseCase: new ListTransactionsUseCase(transactionRepository),
        listCategoriesUseCase: new ListCategoriesUseCase(categoryRepository, transactionRepository),
        listSystemCategoriesUseCase: new ListSystemCategoriesUseCase(transactionRepository),
        createCategoryForMcpUseCase: new CreateCategoryForMcpUseCase(categoryRepository, new CreateCategoryUseCase(categoryRepository), auditRepository),
        createTransactionForMcpUseCase: unused,
        moveTransactionCategoryUseCase: new MoveTransactionCategoryUseCase(transactionRepository, categoryRepository, updateMultiple, auditRepository),
        bulkMoveTransactionsUseCase: new BulkMoveTransactionsUseCase(transactionRepository, categoryRepository, updateMultiple, auditRepository),
        mergeCategoriesUseCase: new MergeCategoriesUseCase(categoryRepository, unitOfWork),
        renameCategoryForMcpUseCase: new RenameCategoryForMcpUseCase(unitOfWork),
        moveCategoryForMcpUseCase: new MoveCategoryForMcpUseCase(unitOfWork),
        deleteCategoryForMcpUseCase: new DeleteCategoryForMcpUseCase(unitOfWork),
        rollbackOperationUseCase: new RollbackOperationUseCase(
            auditRepository,
            transactionRepository,
            new DeleteCategoryUseCase(categoryRepository),
            new CategoryStructureRollback(unitOfWork),
            categoryRepository,
        ),
    })
}

function caller(tools: McpToolDefinition[]) {
    return (name: string, args: Record<string, unknown> = {}): Promise<any> => {
        const tool = tools.find((t) => t.name === name)
        if (!tool) throw new Error(`tool ${name} não está registrada`)
        return tool.execute(args) as Promise<any>
    }
}

/** A bagunça típica que o importador de boletos deixa: uma categoria por linha de boleto. */
function seedMessyWorld() {
    const world = new InMemoryWorld()

    world.addCategory({ id: 'aluguel', name: 'Aluguel Base ', userId: USER_A })
    world.addCategory({ id: 'iptu6', name: 'Iptu - IPTU/Taxa de lixo ref ano de 2026. - parcela 6/6', userId: USER_A })
    world.addCategory({ id: 'iptu5', name: 'Iptu - IPTU/Taxa de lixo ref ano de 2026. - parcela 5/6', userId: USER_A })
    world.addCategory({ id: 'seguro-linha', name: 'Seguro incêndio - Seguro Incêndio Tokio (anual)', userId: USER_A })
    world.addCategory({ id: 'moradia', name: 'Moradia', userId: USER_A })
    world.addCategory({ id: 'reserva', name: 'fundo de reserva ', userId: USER_A })
    world.addCategory({ id: 'vazia', name: 'Categoria vazia', userId: USER_A })

    world.addTransaction({ id: 'tx-aluguel', userId: USER_A, name: 'Aluguel', categoryId: 'aluguel', amount: 1500, paymentMethod: 'PIX' })
    world.addTransaction({ id: 'tx-iptu6', userId: USER_A, name: 'Iptu 6/6', categoryId: 'iptu6', amount: 220, paymentMethod: 'BANK_SLIP' })
    world.addTransaction({ id: 'tx-iptu5', userId: USER_A, name: 'Iptu 5/6', categoryId: 'iptu5', amount: 220, paymentMethod: 'BANK_SLIP' })
    world.addTransaction({ id: 'tx-seguro', userId: USER_A, name: 'Seguro incêndio', categoryId: 'seguro-linha', amount: 89.9, paymentMethod: 'BANK_SLIP' })
    world.addTransaction({ id: 'tx-sys-faxina', userId: USER_A, name: 'Faxina', category: 'SERVICES', amount: 200, paymentMethod: 'CASH' })
    world.addTransaction({ id: 'tx-sys-seguro', userId: USER_A, name: 'Seguro carro', category: 'SERVICES', amount: 300, paymentMethod: 'BANK_SLIP' })
    world.addTransaction({ id: 'tx-sys-outro', userId: USER_A, name: 'Presente', category: 'OTHER', amount: 50, paymentMethod: 'CASH' })

    // outro usuário, com nomes iguais
    world.addCategory({ id: 'b-aluguel', name: 'Aluguel Base ', userId: USER_B })
    world.addCategory({ id: 'b-moradia', name: 'Moradia', userId: USER_B })
    world.addTransaction({ id: 'b-tx', userId: USER_B, name: 'Aluguel B', categoryId: 'b-aluguel', amount: 900 })
    world.addTransaction({ id: 'b-tx-sys', userId: USER_B, name: 'Faxina B', category: 'SERVICES', amount: 90 })

    return world
}

describe('MCP category reorganization — end to end through the tools', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    it('reorganizes a messy category tree from list to rename/merge/move/bulk/delete, and every step is reversible', async () => {
        const world = seedMessyWorld()
        const call = caller(buildTools(world, USER_A))

        // 1) list_categories: personalizadas + de sistema, mesmos ids que list_transactions usa
        const listed = await call('list_categories')
        const custom = listed.categories.filter((c: any) => !c.isSystem)
        const system = listed.categories.filter((c: any) => c.isSystem)
        expect(custom.map((c: any) => c.id).sort()).toEqual(['aluguel', 'iptu5', 'iptu6', 'moradia', 'reserva', 'seguro-linha', 'vazia'])
        expect(system.find((c: any) => c.id === 'system:SERVICES')).toMatchObject({ name: 'SERVICES', transactionCount: 2, isSystem: true })
        expect(system.find((c: any) => c.id === 'system:OTHER')).toMatchObject({ transactionCount: 1 })

        const transactions = await call('list_transactions', { month: 3, year: 2026 })
        const byId = new Map(transactions.map((t: any) => [t.id, t]))
        expect((byId.get('tx-aluguel') as any).categoryId).toBe('aluguel')
        expect((byId.get('tx-sys-faxina') as any)).toMatchObject({ category: 'SERVICES', categoryId: 'system:SERVICES' })
        const knownIds = new Set(listed.categories.map((c: any) => c.id))
        expect(transactions.every((t: any) => knownIds.has(t.categoryId))).toBe(true)

        // 2) rename: limpa o espaço no final
        const renamed = await call('rename_category', { categoryId: 'aluguel', newName: 'Aluguel Base' })
        expect(renamed).toMatchObject({ changed: true, name: 'Aluguel Base' })

        // 3) merge (2 chamadas): parcela 5/6 -> parcela 6/6
        const dry = await call('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6' })
        expect(dry).toMatchObject({ canExecute: true, transactionCount: 1, conflicts: [] })
        const before = world.snapshot()
        expect(await call('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6' })).toBeTruthy() // outro dry-run: ainda não muda nada
        expect(world.snapshot().categories).toEqual(before.categories)
        const merged = await call('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6', dryRun: false, confirmationToken: dry.confirmationToken })
        expect(merged).toMatchObject({ movedTransactionCount: 1, deletedCategoryId: 'iptu5', alreadyExecuted: false })
        expect(world.category('iptu5')).toBeUndefined()
        expect(world.transaction('tx-iptu5').categoryId).toBe('iptu6')

        // 4) rename + move: "IPTU" sob "Moradia"
        await call('rename_category', { categoryId: 'iptu6', newName: 'IPTU' })
        const moved = await call('move_category', { categoryId: 'iptu6', newParentId: 'moradia' })
        expect(moved).toMatchObject({ changed: true, previousParentId: null, newParentId: 'moradia' })

        // 5) bulk com os filtros novos, partindo de uma categoria de SISTEMA
        const seguros = await call('create_category', { name: 'Seguros' })
        const bulkDry = await call('bulk_move_transactions', {
            filter: { currentCategoryId: 'system:SERVICES', nameContainsAny: ['seguro', 'apólice'], paymentMethod: 'BANK_SLIP', type: 'EXPENSE', amountMin: 100 },
            newCategoryId: seguros.id,
        })
        expect(bulkDry.count).toBe(1)
        expect(bulkDry.preview).toEqual([
            expect.objectContaining({ id: 'tx-sys-seguro', name: 'Seguro carro', amount: 300, previousCategoryId: null, previousCategoryName: 'SERVICES' }),
        ])
        const bulkDone = await call('bulk_move_transactions', {
            filter: { currentCategoryId: 'system:SERVICES', nameContainsAny: ['seguro', 'apólice'], paymentMethod: 'BANK_SLIP', type: 'EXPENSE', amountMin: 100 },
            newCategoryId: seguros.id,
            dryRun: false,
            confirmationToken: bulkDry.confirmationToken,
        })
        expect(bulkDone.updatedCount).toBe(1)
        expect(world.transaction('tx-sys-seguro').categoryId).toBe(seguros.id)
        expect(world.transaction('tx-sys-faxina').categoryId).toBeNull() // a outra SERVICES não foi tocada

        // 6) delete: não apaga o que tem dependentes; apaga a vazia
        await expect(call('delete_category', { categoryId: 'moradia' })).rejects.toThrow(/CATEGORY_IN_USE.*subcategoria/)
        const deleted = await call('delete_category', { categoryId: 'vazia' })
        expect(world.category('vazia')).toBeUndefined()

        // 7) tudo é reversível pelo operationId
        const revertedDelete = await call('rollback_operation', { operationId: deleted.operationId })
        expect(revertedDelete).toMatchObject({ rolledBack: true, restoredCategoryId: 'vazia' })
        expect(world.category('vazia')).toMatchObject({ id: 'vazia', name: 'Categoria vazia' })

        const revertedMove = await call('rollback_operation', { operationId: moved.operationId })
        expect(revertedMove.rolledBack).toBe(true)
        expect(world.category('iptu6')!.parentId).toBeNull()

        const revertedMerge = await call('rollback_operation', { operationId: merged.operationId })
        expect(revertedMerge).toMatchObject({ rolledBack: true, restoredCategoryId: 'iptu5', restoredTransactionCount: 1, skipped: [] })
        expect(world.category('iptu5')).toMatchObject({ id: 'iptu5', name: 'Iptu - IPTU/Taxa de lixo ref ano de 2026. - parcela 5/6' })
        expect(world.transaction('tx-iptu5').categoryId).toBe('iptu5')
        expect(world.transaction('tx-iptu6').categoryId).toBe('iptu6')

        const revertedBulk = await call('rollback_operation', { operationId: bulkDone.operationId })
        expect(revertedBulk.rolledBack).toBe(true)
        expect(world.transaction('tx-sys-seguro')).toMatchObject({ categoryId: null, category: 'SERVICES' })
    })

    it('rejects a merge confirmation once the affected set changed, and nothing is altered', async () => {
        const world = seedMessyWorld()
        const call = caller(buildTools(world, USER_A))
        const dry = await call('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6' })
        world.addTransaction({ id: 'tx-late', userId: USER_A, name: 'Iptu extra', categoryId: 'iptu5' })
        const before = world.snapshot()

        await expect(
            call('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6', dryRun: false, confirmationToken: dry.confirmationToken }),
        ).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        expect(world.snapshot()).toEqual(before)
    })

    it('an unknown or expired confirmationToken never merges anything', async () => {
        const world = seedMessyWorld()
        const call = caller(buildTools(world, USER_A))
        const before = world.snapshot()

        await expect(
            call('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6', dryRun: false, confirmationToken: 'expirado' }),
        ).rejects.toThrow(/CONFIRMATION_EXPIRED/)
        expect(world.snapshot()).toEqual(before)
    })
})

describe('MCP category reorganization — isolation between users', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    it('user B cannot see, rename, move, merge, delete or roll back anything of user A — through any tool', async () => {
        const world = seedMessyWorld()
        const callA = caller(buildTools(world, USER_A))
        const callB = caller(buildTools(world, USER_B))

        // A cria uma operação reversível pra B tentar reverter
        const renamed = await callA('rename_category', { categoryId: 'aluguel', newName: 'Aluguel Base' })
        const dryA = await callA('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6' })
        const before = world.snapshot()

        await expect(callB('rename_category', { categoryId: 'aluguel', newName: 'X' })).rejects.toThrow('Categoria não encontrada')
        await expect(callB('move_category', { categoryId: 'iptu6', newParentId: null })).rejects.toThrow('Categoria não encontrada')
        await expect(callB('move_category', { categoryId: 'b-aluguel', newParentId: 'moradia' })).rejects.toThrow('Categoria pai não encontrada')
        await expect(callB('delete_category', { categoryId: 'vazia' })).rejects.toThrow('Categoria não encontrada')
        await expect(callB('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6' })).rejects.toThrow('Categoria de origem não encontrada')
        await expect(callB('merge_categories', { sourceId: 'b-aluguel', targetId: 'iptu6' })).rejects.toThrow('Categoria de destino não encontrada')
        await expect(callB('rollback_operation', { operationId: renamed.operationId })).rejects.toThrow('Operação não encontrada')
        await expect(callB('move_transaction_category', { transactionId: 'tx-aluguel', newCategoryId: 'b-moradia' })).rejects.toThrow('Transação não encontrada')
        await expect(callB('move_transaction_category', { transactionId: 'b-tx', newCategoryId: 'aluguel' })).rejects.toThrow('Categoria de destino não encontrada')

        // o token de confirmação emitido pra A não serve pra B
        await expect(
            callB('merge_categories', { sourceId: 'iptu5', targetId: 'iptu6', dryRun: false, confirmationToken: dryA.confirmationToken }),
        ).rejects.toThrow(/não pertence a este usuário/)

        expect(world.snapshot()).toEqual(before)
    })

    it('user B\'s own legitimate reorganization (same names as A\'s) leaves A completely untouched', async () => {
        const world = seedMessyWorld()
        const callB = caller(buildTools(world, USER_B))
        const aBefore = {
            categories: world.categories.filter((c) => c.userId === USER_A).map((c) => ({ ...c })),
            transactions: world.transactions.filter((t) => t.userId === USER_A).map((t) => ({ ...t })),
        }

        await callB('rename_category', { categoryId: 'b-aluguel', newName: 'Aluguel Base' })
        const dry = await callB('merge_categories', { sourceId: 'b-aluguel', targetId: 'b-moradia' })
        const done = await callB('merge_categories', { sourceId: 'b-aluguel', targetId: 'b-moradia', dryRun: false, confirmationToken: dry.confirmationToken })
        await callB('rollback_operation', { operationId: done.operationId })
        await callB('delete_category', { categoryId: 'b-aluguel' }).catch(() => undefined) // tem transação: recusa

        expect(world.categories.filter((c) => c.userId === USER_A)).toEqual(aBefore.categories)
        expect(world.transactions.filter((t) => t.userId === USER_A)).toEqual(aBefore.transactions)
        expect(world.audits.every((a) => a.userId === USER_B)).toBe(true)
    })

    it('a filter-based bulk move by user B never reaches user A\'s transactions, even for a system category both have', async () => {
        const world = seedMessyWorld()
        const callB = caller(buildTools(world, USER_B))

        const dry = await callB('bulk_move_transactions', { filter: { currentCategoryId: 'system:SERVICES' }, newCategoryId: 'b-moradia' })

        expect(dry.preview.map((p: any) => p.id)).toEqual(['b-tx-sys'])
        await callB('bulk_move_transactions', { filter: { currentCategoryId: 'system:SERVICES' }, newCategoryId: 'b-moradia', dryRun: false, confirmationToken: dry.confirmationToken })

        expect(world.transaction('b-tx-sys').categoryId).toBe('b-moradia')
        expect(world.transaction('tx-sys-faxina').categoryId).toBeNull()
        expect(world.transaction('tx-sys-seguro').categoryId).toBeNull()
    })

    it('list tools only ever return the caller\'s own data', async () => {
        const world = seedMessyWorld()
        const callB = caller(buildTools(world, USER_B))

        const categories = await callB('list_categories')
        expect(categories.categories.filter((c: any) => !c.isSystem).map((c: any) => c.id).sort()).toEqual(['b-aluguel', 'b-moradia'])
        expect(categories.categories.find((c: any) => c.id === 'system:SERVICES').transactionCount).toBe(1) // só a "Faxina B"

        const transactions = await callB('list_transactions', { month: 3, year: 2026 })
        expect(transactions.map((t: any) => t.id).sort()).toEqual(['b-tx', 'b-tx-sys'])
    })
})

describe('MCP category reorganization — write scope (over the real MCP wire protocol)', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    const NEW_TOOLS = ['merge_categories', 'rename_category', 'move_category', 'delete_category']

    async function rpc(tools: McpToolDefinition[], method: string, params: Record<string, unknown> = {}) {
        const handler = createMcpHandler(() => buildMcpServer(tools))
        const response = await handler.fetch(
            new Request('http://localhost/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            }),
        )
        const text = await response.text()
        const payload = text.startsWith('event:') || text.includes('\ndata:') || text.startsWith('data:')
            ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())[0]
            : text
        return JSON.parse(payload)
    }

    it('a read-only token neither lists nor can call the new write tools, even by their exact name', async () => {
        const world = seedMessyWorld()
        const tools = buildTools(world, USER_A, 'read')

        const listed = await rpc(tools, 'tools/list')
        const names = listed.result.tools.map((t: any) => t.name)
        for (const name of NEW_TOOLS) expect(names).not.toContain(name)
        expect(names).toContain('list_categories')

        const before = world.snapshot()
        for (const [name, args] of [
            ['merge_categories', { sourceId: 'iptu5', targetId: 'iptu6' }],
            ['rename_category', { categoryId: 'aluguel', newName: 'X' }],
            ['move_category', { categoryId: 'iptu6', newParentId: null }],
            ['delete_category', { categoryId: 'vazia' }],
        ] as const) {
            const response = await rpc(tools, 'tools/call', { name, arguments: args })
            const failed = response.error !== undefined || response.result?.isError === true
            expect(failed, `${name} must be rejected for a read-only token`).toBe(true)
        }
        expect(world.snapshot()).toEqual(before)
    })

    it('a read_write token lists all 15 tools and can run the new ones through the protocol', async () => {
        const world = seedMessyWorld()
        const tools = buildTools(world, USER_A, 'read_write')

        const listed = await rpc(tools, 'tools/list')
        const names = listed.result.tools.map((t: any) => t.name)
        expect(names).toHaveLength(15)
        for (const name of NEW_TOOLS) expect(names).toContain(name)

        const dry = await rpc(tools, 'tools/call', { name: 'merge_categories', arguments: { sourceId: 'iptu5', targetId: 'iptu6' } })
        expect(dry.result.isError).toBeFalsy()
        const payload = JSON.parse(dry.result.content[0].text)
        expect(payload).toMatchObject({ canExecute: true, transactionCount: 1 })
        expect(payload.confirmationToken).toMatch(/^[0-9a-f]{48}$/)
    })

    it('the two-call tools are described as such on the wire, in pt-BR', async () => {
        const tools = buildTools(seedMessyWorld(), USER_A, 'read_write')

        const listed = await rpc(tools, 'tools/list')
        const merge = listed.result.tools.find((t: any) => t.name === 'merge_categories')

        expect(merge.description).toContain('ESTA FERRAMENTA EXIGE DUAS CHAMADAS')
        expect(Object.keys(merge.inputSchema.properties)).toEqual(['sourceId', 'targetId', 'dryRun', 'confirmationToken'])
        expect(merge.inputSchema.required).toEqual(['sourceId', 'targetId'])
    })

    it('a domain error reaches the client as a tool error with the actionable message', async () => {
        const tools = buildTools(seedMessyWorld(), USER_A, 'read_write')

        const response = await rpc(tools, 'tools/call', { name: 'delete_category', arguments: { categoryId: 'aluguel' } })

        expect(response.result.isError).toBe(true)
        expect(JSON.parse(response.result.content[0].text).error).toMatch(/CATEGORY_IN_USE.*merge_categories/)
    })
})
