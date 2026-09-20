import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'
import { CategoryStructureRollback } from '../category-structure-rollback'
import { DeleteCategoryForMcpUseCase } from '../delete-category-for-mcp.use-case'
import { MergeCategoriesUseCase } from '../merge-categories.use-case'
import { MoveCategoryForMcpUseCase } from '../move-category-for-mcp.use-case'
import { RenameCategoryForMcpUseCase } from '../rename-category-for-mcp.use-case'
import { RollbackOperationUseCase } from '../rollback-operation.use-case'
import {
    InMemoryAuditRepository,
    InMemoryCategoryRepository,
    InMemoryCategoryUnitOfWork,
    InMemoryWorld,
    createInMemoryTransactionRepository,
} from './helpers/in-memory-category-world'

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

const USER = 'user-1'
const OTHER_USER = 'user-2'
const SOURCE_CREATED_AT = new Date('2026-01-15T08:00:00.000Z')

/**
 * Moradia (root)
 *   └─ Aluguel Base  (source)  ── tx-1, tx-2, tx-deleted(soft) ── filhas: Condomínio, IPTU
 * Casa (root, target)          ── tx-target
 * Lazer (root)
 */
function setup() {
    const world = new InMemoryWorld()
    world.addCategory({ id: 'parent', name: 'Moradia', userId: USER })
    world.addCategory({ id: 'source', name: 'Aluguel Base ', userId: USER, parentId: 'parent', createdAt: SOURCE_CREATED_AT })
    world.addCategory({ id: 'target', name: 'Casa', userId: USER })
    world.addCategory({ id: 'fun', name: 'Lazer', userId: USER })
    world.addCategory({ id: 'child-a', name: 'Condomínio', userId: USER, parentId: 'source' })
    world.addCategory({ id: 'child-b', name: 'IPTU', userId: USER, parentId: 'source' })

    world.addTransaction({ id: 'tx-1', userId: USER, categoryId: 'source' })
    world.addTransaction({ id: 'tx-2', userId: USER, categoryId: 'source' })
    world.addTransaction({ id: 'tx-deleted', userId: USER, categoryId: 'source', deletedAt: new Date('2026-02-01') })
    world.addTransaction({ id: 'tx-target', userId: USER, categoryId: 'target' })

    world.addCategory({ id: 'other-cat', name: 'Alheia', userId: OTHER_USER })
    world.addTransaction({ id: 'other-tx', userId: OTHER_USER, categoryId: 'other-cat' })

    const uow = new InMemoryCategoryUnitOfWork(world)
    const categoryRepository = new InMemoryCategoryRepository(world)
    const rollback = new RollbackOperationUseCase(
        new InMemoryAuditRepository(world),
        createInMemoryTransactionRepository(world),
        new DeleteCategoryUseCase(categoryRepository),
        new CategoryStructureRollback(uow),
        categoryRepository,
    )

    return {
        world,
        uow,
        rollback,
        merge: new MergeCategoriesUseCase(categoryRepository, uow),
        rename: new RenameCategoryForMcpUseCase(uow),
        move: new MoveCategoryForMcpUseCase(uow),
        remove: new DeleteCategoryForMcpUseCase(uow),
    }
}

async function mergeSourceIntoTarget(merge: MergeCategoriesUseCase) {
    const dry = await merge.dryRun(USER, 'source', 'target')
    return merge.confirm(USER, dry.confirmationToken!, 'source', 'target')
}

describe('rollback_operation — merge_categories', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    it('fully reverts: recreates the source with the SAME id, name, parent and createdAt, restores subcategories and transactions', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        expect(world.category('source')).toBeUndefined()

        const result = await rollback.execute(USER, operationId)

        expect(result).toMatchObject({
            operationId,
            tool: 'merge_categories',
            rolledBack: true,
            skipped: [],
            skippedCategories: [],
            restoredCategoryId: 'source',
            restoredTransactionCount: 3,
            restoredSubcategoryCount: 2,
        })

        const restored = world.category('source')!
        expect(restored).toMatchObject({ id: 'source', name: 'Aluguel Base ', parentId: 'parent', userId: USER })
        expect(restored.createdAt).toEqual(SOURCE_CREATED_AT)

        expect(world.category('child-a')!.parentId).toBe('source')
        expect(world.category('child-b')!.parentId).toBe('source')
        for (const id of ['tx-1', 'tx-2', 'tx-deleted']) {
            expect(world.transaction(id).categoryId).toBe('source')
        }
        // o que já era do destino continua do destino
        expect(world.transaction('tx-target').categoryId).toBe('target')
        expect(world.audits.find((a) => a.id === operationId)!.rolledBackAt).not.toBeNull()
    })

    it('skips (and reports) transactions that were changed after the merge, never overwriting them', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        world.transaction('tx-2').categoryId = 'fun' // alguém reclassificou depois

        const result = await rollback.execute(USER, operationId)

        expect(result.skipped).toEqual([
            { transactionId: 'tx-2', reason: 'Categoria foi alterada manualmente depois da operação original' },
        ])
        expect(result.restoredTransactionCount).toBe(2)
        expect(world.transaction('tx-2').categoryId).toBe('fun')
        expect(world.transaction('tx-1').categoryId).toBe('source')
        expect(world.category('source')).toBeDefined()
    })

    it('skips a transaction that no longer exists', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        world.transactions = world.transactions.filter((t) => t.id !== 'tx-1')

        const result = await rollback.execute(USER, operationId)

        expect(result.skipped).toEqual([{ transactionId: 'tx-1', reason: 'Transação não encontrada' }])
        expect(result.rolledBack).toBe(true)
    })

    it('skips (and reports) a subcategory that was moved or deleted after the merge', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        world.category('child-a')!.parentId = 'fun' // movida de novo depois
        world.categories = world.categories.filter((c) => c.id !== 'child-b') // e outra sumiu

        const result = await rollback.execute(USER, operationId)

        expect(result.skippedCategories).toEqual([
            { categoryId: 'child-a', reason: 'Subcategoria foi movida ou reapontada de novo depois do merge' },
            { categoryId: 'child-b', reason: 'Subcategoria não existe mais' },
        ])
        expect(result.restoredSubcategoryCount).toBe(0)
        expect(world.category('child-a')!.parentId).toBe('fun')
    })

    it('does not restore a subcategory whose subtree no longer fits in 3 levels (e.g. the parent was moved deeper meanwhile)', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        // Moradia foi parar embaixo de Lazer: Aluguel voltaria no nível 3, e as filhas no 4
        world.category('parent')!.parentId = 'fun'

        const result = await rollback.execute(USER, operationId)

        expect(result.restoredCategoryId).toBe('source')
        expect(result.skippedCategories).toHaveLength(2)
        expect(result.skippedCategories!.every((c) => c.reason.includes('profundidade máxima'))).toBe(true)
        expect(world.category('child-a')!.parentId).toBe('target')
    })

    it('is blocked, changing NOTHING, when the original name is now taken under the same parent', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        world.addCategory({ id: 'squatter', name: 'aluguel base', userId: USER, parentId: 'parent' })
        const before = world.snapshot()

        await expect(rollback.execute(USER, operationId)).rejects.toThrow(/ROLLBACK_BLOCKED.*squatter/)

        expect(world.snapshot()).toEqual(before)
        expect(world.audits.find((a) => a.id === operationId)!.rolledBackAt).toBeNull()
    })

    it('is blocked, changing NOTHING, when the original parent no longer exists', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        world.categories = world.categories.filter((c) => c.id !== 'parent')
        const before = world.snapshot()

        await expect(rollback.execute(USER, operationId)).rejects.toThrow(/ROLLBACK_BLOCKED.*pai original/)

        expect(world.snapshot()).toEqual(before)
    })

    it('cannot be reverted twice', async () => {
        const { rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)

        await rollback.execute(USER, operationId)

        await expect(rollback.execute(USER, operationId)).rejects.toThrow('Operação já foi revertida')
    })

    it('cannot be reverted by another user, who does not even see the operation', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        const before = world.snapshot()

        await expect(rollback.execute(OTHER_USER, operationId)).rejects.toThrow('Operação não encontrada')

        expect(world.snapshot()).toEqual(before)
    })

    it('is atomic: a failure midway leaves the merged state untouched and the operation still revertible', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)
        const before = world.snapshot()
        const spy = vi.spyOn(InMemoryCategoryRepository.prototype, 'assignTransactionsToCategory').mockRejectedValueOnce(new Error('boom'))

        await expect(rollback.execute(USER, operationId)).rejects.toThrow('boom')

        expect(world.snapshot()).toEqual(before)
        expect(world.category('source')).toBeUndefined() // a recriação também foi desfeita
        spy.mockRestore()

        const retry = await rollback.execute(USER, operationId)
        expect(retry.rolledBack).toBe(true)
        expect(world.category('source')).toBeDefined()
    })

    it('does not touch another user\'s data', async () => {
        const { world, rollback, merge } = setup()
        const { operationId } = await mergeSourceIntoTarget(merge)

        await rollback.execute(USER, operationId)

        expect(world.transaction('other-tx').categoryId).toBe('other-cat')
    })
})

describe('rollback_operation — delete_category', () => {
    it('recreates the deleted category with the SAME id, name, parent and createdAt', async () => {
        const { world, rollback, remove } = setup()
        world.addCategory({ id: 'empty', name: 'Vazia ', userId: USER, parentId: 'parent', createdAt: SOURCE_CREATED_AT })
        const { operationId } = await remove.execute({ userId: USER, categoryId: 'empty' })
        expect(world.category('empty')).toBeUndefined()

        const result = await rollback.execute(USER, operationId)

        expect(result).toMatchObject({ tool: 'delete_category', rolledBack: true, restoredCategoryId: 'empty', skipped: [] })
        const restored = world.category('empty')!
        expect(restored).toMatchObject({ id: 'empty', name: 'Vazia ', parentId: 'parent', userId: USER })
        expect(restored.createdAt).toEqual(SOURCE_CREATED_AT)
    })

    it('is blocked when the name was taken meanwhile, and when the original parent is gone', async () => {
        const { world, rollback, remove } = setup()
        world.addCategory({ id: 'empty', name: 'Vazia', userId: USER, parentId: 'parent' })
        const { operationId } = await remove.execute({ userId: USER, categoryId: 'empty' })

        world.addCategory({ id: 'squatter', name: 'VAZIA', userId: USER, parentId: 'parent' })
        await expect(rollback.execute(USER, operationId)).rejects.toThrow(/ROLLBACK_BLOCKED.*ocupado/)

        world.categories = world.categories.filter((c) => c.id !== 'squatter' && c.id !== 'parent')
        await expect(rollback.execute(USER, operationId)).rejects.toThrow(/ROLLBACK_BLOCKED.*pai original/)
        expect(world.category('empty')).toBeUndefined()
    })

    it('cannot be reverted by another user', async () => {
        const { world, rollback, remove } = setup()
        world.addCategory({ id: 'empty', name: 'Vazia', userId: USER })
        const { operationId } = await remove.execute({ userId: USER, categoryId: 'empty' })

        await expect(rollback.execute(OTHER_USER, operationId)).rejects.toThrow('Operação não encontrada')
        expect(world.category('empty')).toBeUndefined()
    })
})

describe('rollback_operation — rename_category', () => {
    it('restores the previous name (trailing space included)', async () => {
        const { world, rollback, rename } = setup()
        const { operationId } = await rename.execute({ userId: USER, categoryId: 'source', newName: 'Aluguel Base' })

        const result = await rollback.execute(USER, operationId!)

        expect(result).toMatchObject({ tool: 'rename_category', rolledBack: true })
        expect(world.category('source')!.name).toBe('Aluguel Base ')
    })

    it('is blocked if renamed again meanwhile (never overwrites the latest change)', async () => {
        const { world, rollback, rename } = setup()
        const { operationId } = await rename.execute({ userId: USER, categoryId: 'source', newName: 'Aluguel' })
        await rename.execute({ userId: USER, categoryId: 'source', newName: 'Aluguel 2026' })

        await expect(rollback.execute(USER, operationId!)).rejects.toThrow(/ROLLBACK_BLOCKED.*renomeada de novo/)
        expect(world.category('source')!.name).toBe('Aluguel 2026')
    })

    it('is blocked when the original name now belongs to a sibling', async () => {
        const { world, rollback, rename } = setup()
        const { operationId } = await rename.execute({ userId: USER, categoryId: 'target', newName: 'Casa Nova' })
        world.addCategory({ id: 'squatter', name: 'Casa', userId: USER })

        await expect(rollback.execute(USER, operationId!)).rejects.toThrow(/ROLLBACK_BLOCKED.*squatter/)
        expect(world.category('target')!.name).toBe('Casa Nova')
    })
})

describe('rollback_operation — move_category', () => {
    it('restores the previous parent', async () => {
        const { world, rollback, move } = setup()
        const { operationId } = await move.execute({ userId: USER, categoryId: 'source', newParentId: null })
        expect(world.category('source')!.parentId).toBeNull()

        const result = await rollback.execute(USER, operationId!)

        expect(result).toMatchObject({ tool: 'move_category', rolledBack: true })
        expect(world.category('source')!.parentId).toBe('parent')
    })

    it('is blocked if moved again meanwhile', async () => {
        const { world, rollback, move } = setup()
        const { operationId } = await move.execute({ userId: USER, categoryId: 'source', newParentId: null })
        await move.execute({ userId: USER, categoryId: 'source', newParentId: 'fun' })

        await expect(rollback.execute(USER, operationId!)).rejects.toThrow(/ROLLBACK_BLOCKED.*movida de novo/)
        expect(world.category('source')!.parentId).toBe('fun')
    })

    it('is blocked when the old parent is gone', async () => {
        const { world, rollback, move } = setup()
        const { operationId } = await move.execute({ userId: USER, categoryId: 'source', newParentId: null })
        world.categories = world.categories.filter((c) => c.id !== 'parent')

        await expect(rollback.execute(USER, operationId!)).rejects.toThrow(/ROLLBACK_BLOCKED.*Categoria pai não encontrada/)
        expect(world.category('source')!.parentId).toBeNull()
    })

    it('is blocked when restoring the old parent would now create a cycle', async () => {
        const { world, rollback, move } = setup()
        // 1) "parent"(Moradia) > "source" vira raiz; 2) depois "parent" é movida pra baixo de "source"
        const { operationId } = await move.execute({ userId: USER, categoryId: 'source', newParentId: null })
        await move.execute({ userId: USER, categoryId: 'parent', newParentId: 'source' })

        // desfazer o passo 1 poria source > parent, mas parent já está sob source => ciclo
        await expect(rollback.execute(USER, operationId!)).rejects.toThrow(/ROLLBACK_BLOCKED.*CYCLE/)
        expect(world.category('source')!.parentId).toBeNull()
    })
})

describe('rollback_operation — routing', () => {
    it('rejects structure tools when no CategoryStructureRollback was wired (safe default)', async () => {
        const { world, uow } = setup()
        const audit = new InMemoryAuditRepository(world)
        const entry = await audit.create({ userId: USER, tool: 'merge_categories', params: {}, previousState: {}, newState: {} })
        const categoryRepository = new InMemoryCategoryRepository(world)
        const bare = new RollbackOperationUseCase(audit, createInMemoryTransactionRepository(world), new DeleteCategoryUseCase(categoryRepository))

        await expect(bare.execute(USER, entry.id)).rejects.toThrow('Rollback não suportado para a ferramenta "merge_categories"')
        expect(uow.runs).toBe(0)
    })

    it('still rejects unknown tools', async () => {
        const { world, rollback } = setup()
        const audit = new InMemoryAuditRepository(world)
        const entry = await audit.create({ userId: USER, tool: 'made_up_tool', params: {}, previousState: {}, newState: {} })

        await expect(rollback.execute(USER, entry.id)).rejects.toThrow('Rollback não suportado para a ferramenta "made_up_tool"')
    })
})
