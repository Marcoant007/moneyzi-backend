import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergeCategoriesUseCase } from '../merge-categories.use-case'
import { InMemoryAuditRepository, InMemoryCategoryRepository, InMemoryCategoryUnitOfWork, InMemoryWorld } from './helpers/in-memory-category-world'

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

/**
 * Aluguel Base  (source, raiz)  ── 3 transações (1 excluída)
 *   ├─ Condomínio  ── 1 transação
 *   └─ IPTU
 *        └─ Taxa de lixo
 * Casa (target, raiz)  ── 1 transação
 * Moradia (raiz, vazia)
 *
 * Depois do merge a árvore de IPTU cabe em 3 níveis (Casa > IPTU > Taxa de lixo).
 */
function setup() {
    const world = new InMemoryWorld()
    world.addCategory({ id: 'moradia', name: 'Moradia', userId: USER })
    world.addCategory({ id: 'source', name: 'Aluguel Base ', userId: USER })
    world.addCategory({ id: 'target', name: 'Casa', userId: USER })
    world.addCategory({ id: 'child-a', name: 'Condomínio', userId: USER, parentId: 'source' })
    world.addCategory({ id: 'child-b', name: 'IPTU', userId: USER, parentId: 'source' })
    world.addCategory({ id: 'grandchild', name: 'Taxa de lixo', userId: USER, parentId: 'child-b' })

    world.addTransaction({ id: 'tx-1', userId: USER, categoryId: 'source' })
    world.addTransaction({ id: 'tx-2', userId: USER, categoryId: 'source' })
    world.addTransaction({ id: 'tx-deleted', userId: USER, categoryId: 'source', deletedAt: new Date('2026-02-01') })
    world.addTransaction({ id: 'tx-target', userId: USER, categoryId: 'target' })
    world.addTransaction({ id: 'tx-child', userId: USER, categoryId: 'child-a' })

    // dados de OUTRO usuário, com nomes iguais — nunca podem ser tocados
    world.addCategory({ id: 'other-source', name: 'Aluguel Base ', userId: OTHER_USER })
    world.addCategory({ id: 'other-target', name: 'Casa', userId: OTHER_USER })
    world.addTransaction({ id: 'other-tx', userId: OTHER_USER, categoryId: 'other-source' })

    const uow = new InMemoryCategoryUnitOfWork(world)
    const useCase = new MergeCategoriesUseCase(new InMemoryCategoryRepository(world), uow)
    return { world, uow, useCase }
}

describe('MergeCategoriesUseCase.dryRun', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    it('never mutates anything, opens no database transaction and writes no audit', async () => {
        const { world, uow, useCase } = setup()
        const before = world.snapshot()

        await useCase.dryRun(USER, 'source', 'target')

        expect(world.snapshot()).toEqual(before)
        expect(uow.runs).toBe(0)
        expect(world.audits).toHaveLength(0)
    })

    it('reports affected transactions (soft-deleted included), re-pointed subcategories and a confirmationToken', async () => {
        const { useCase } = setup()

        const result = await useCase.dryRun(USER, 'source', 'target')

        expect(result.transactionCount).toBe(3)
        expect(result.softDeletedTransactionCount).toBe(1)
        expect(result.reparentedSubcategories.map((c) => c.id).sort()).toEqual(['child-a', 'child-b'])
        expect(result.conflicts).toEqual([])
        expect(result.canExecute).toBe(true)
        expect(result.confirmationToken).toMatch(/^[0-9a-f]{48}$/)
        expect(result.expiresInSeconds).toBe(600)
        expect(result.message).toContain('dryRun:false')
    })

    it('lists name conflicts, issues NO token and stores nothing in Redis', async () => {
        const { world, useCase } = setup()
        world.addCategory({ id: 'target-iptu', name: 'iptu ', userId: USER, parentId: 'target' })

        const result = await useCase.dryRun(USER, 'source', 'target')

        expect(result.canExecute).toBe(false)
        expect(result.confirmationToken).toBeNull()
        expect(result.expiresInSeconds).toBeNull()
        expect(result.conflicts).toEqual([
            {
                name: 'IPTU',
                sourceChild: { id: 'child-b', name: 'IPTU' },
                targetChild: { id: 'target-iptu', name: 'iptu ' },
            },
        ])
        expect(result.message).toContain('MERGE_CONFLICT')
        expect(store.size).toBe(0)
    })

    it('rejects source === target', async () => {
        const { useCase } = setup()
        await expect(useCase.dryRun(USER, 'source', 'source')).rejects.toThrow(/SAME_CATEGORY/)
    })

    it('rejects a target that is a descendant of the source (cycle)', async () => {
        const { useCase } = setup()
        await expect(useCase.dryRun(USER, 'source', 'child-a')).rejects.toThrow(/CYCLE/)
        await expect(useCase.dryRun(USER, 'source', 'grandchild')).rejects.toThrow(/CYCLE/)
    })

    it('rejects a merge that would push the re-pointed subtree past 3 levels', async () => {
        const { world, useCase } = setup()
        // IPTU + Taxa de lixo = altura 2; com o destino no nível 2 ficaria em 2 + 2 = 4
        world.addCategory({ id: 'deep-root', name: 'Raiz nova', userId: USER })
        world.addCategory({ id: 'deep-target', name: 'Destino fundo', userId: USER, parentId: 'deep-root' })

        await expect(useCase.dryRun(USER, 'source', 'deep-target')).rejects.toThrow(/MAX_DEPTH_EXCEEDED.*IPTU/)
    })

    it('treats another user\'s category as not found — on either side', async () => {
        const { useCase } = setup()
        await expect(useCase.dryRun(USER, 'other-source', 'target')).rejects.toThrow('Categoria de origem não encontrada')
        await expect(useCase.dryRun(USER, 'source', 'other-target')).rejects.toThrow('Categoria de destino não encontrada')
    })

    it('refuses system categories with an explanatory error', async () => {
        const { useCase } = setup()
        await expect(useCase.dryRun(USER, 'system:HOUSING', 'target')).rejects.toThrow(/SYSTEM_CATEGORY/)
        await expect(useCase.dryRun(USER, 'source', 'system:OTHER')).rejects.toThrow(/SYSTEM_CATEGORY/)
    })
})

describe('MergeCategoriesUseCase.confirm', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    async function dryRunToken(useCase: MergeCategoriesUseCase) {
        const result = await useCase.dryRun(USER, 'source', 'target')
        return result.confirmationToken!
    }

    it('moves every transaction, re-points the subtree, deletes the source and audits — in ONE database transaction', async () => {
        const { world, uow, useCase } = setup()
        const token = await dryRunToken(useCase)

        const result = await useCase.confirm(USER, token, 'source', 'target')

        expect(result).toMatchObject({
            movedTransactionCount: 3,
            reparentedSubcategoryCount: 2,
            deletedCategoryId: 'source',
            alreadyExecuted: false,
        })
        expect(uow.runs).toBe(1)

        // source apagada; destino intacto
        expect(world.category('source')).toBeUndefined()
        expect(world.category('target')).toBeDefined()

        // TODAS as transações (a soft-deleted inclusive) foram pro destino — nenhuma orfanada pelo SET NULL
        for (const id of ['tx-1', 'tx-2', 'tx-deleted']) {
            expect(world.transaction(id).categoryId).toBe('target')
        }
        expect(world.transaction('tx-target').categoryId).toBe('target')
        expect(world.transaction('tx-child').categoryId).toBe('child-a')

        // filhas reapontadas (a neta acompanha a filha); nenhuma virou raiz por SET NULL
        expect(world.category('child-a')!.parentId).toBe('target')
        expect(world.category('child-b')!.parentId).toBe('target')
        expect(world.category('grandchild')!.parentId).toBe('child-b')

        expect(world.audits).toHaveLength(1)
        expect(world.audits[0]).toMatchObject({
            id: result.operationId,
            userId: USER,
            tool: 'merge_categories',
            params: { sourceId: 'source', targetId: 'target' },
            newState: { targetId: 'target' },
        })
        const previous = world.audits[0].previousState as any
        expect(previous.category).toMatchObject({ id: 'source', name: 'Aluguel Base ', parentId: null })
        expect(previous.transactionIds.sort()).toEqual(['tx-1', 'tx-2', 'tx-deleted'])
        expect(previous.childIds.sort()).toEqual(['child-a', 'child-b'])
    })

    it('does not touch another user\'s data', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)

        await useCase.confirm(USER, token, 'source', 'target')

        expect(world.category('other-source')).toBeDefined()
        expect(world.transaction('other-tx').categoryId).toBe('other-source')
    })

    it('is idempotent: repeating the confirm returns the original operationId and changes nothing more', async () => {
        const { world, uow, useCase } = setup()
        const token = await dryRunToken(useCase)

        const first = await useCase.confirm(USER, token, 'source', 'target')
        const second = await useCase.confirm(USER, token, 'source', 'target')

        expect(second).toMatchObject({ alreadyExecuted: true, operationId: first.operationId, movedTransactionCount: 0 })
        expect(world.audits).toHaveLength(1)
        expect(uow.runs).toBe(1)
    })

    it('rejects an unknown or expired token with CONFIRMATION_EXPIRED', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.confirm(USER, 'never-issued', 'source', 'target')).rejects.toThrow(/CONFIRMATION_EXPIRED/)
        expect(world.snapshot()).toEqual(before)
    })

    it('rejects a token issued to another user', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        const before = world.snapshot()

        await expect(useCase.confirm(OTHER_USER, token, 'source', 'target')).rejects.toThrow('Token de confirmação não pertence a este usuário')
        expect(world.snapshot()).toEqual(before)
    })

    it('rejects a token used with different source/target than the dry-run', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        const before = world.snapshot()

        await expect(useCase.confirm(USER, token, 'source', 'moradia')).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        await expect(useCase.confirm(USER, token, 'target', 'source')).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        expect(world.snapshot()).toEqual(before)
    })

    it('invalidates the token when a transaction ENTERS the affected set', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        world.addTransaction({ id: 'tx-new', userId: USER, categoryId: 'source' })
        const before = world.snapshot()

        await expect(useCase.confirm(USER, token, 'source', 'target')).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        expect(world.snapshot()).toEqual(before)
        expect(world.category('source')).toBeDefined()
    })

    it('invalidates the token when a transaction LEAVES the affected set', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        world.transaction('tx-2').categoryId = 'target'

        await expect(useCase.confirm(USER, token, 'source', 'target')).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        expect(world.category('source')).toBeDefined()
    })

    it('invalidates the token when a subcategory is added to the source', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        world.addCategory({ id: 'child-new', name: 'Seguro', userId: USER, parentId: 'source' })

        await expect(useCase.confirm(USER, token, 'source', 'target')).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        expect(world.category('child-new')!.parentId).toBe('source')
    })

    it('refuses to execute if a name conflict appeared after the dry-run', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        world.addCategory({ id: 'target-condo', name: 'condomínio', userId: USER, parentId: 'target' })
        const before = world.snapshot()

        await expect(useCase.confirm(USER, token, 'source', 'target')).rejects.toThrow(/MERGE_CONFLICT/)
        expect(world.snapshot()).toEqual(before)
    })

    it('is atomic: a failure in the LAST step (the delete) undoes the transaction move and the re-parenting', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        const before = world.snapshot()
        const spy = vi.spyOn(InMemoryCategoryRepository.prototype, 'deleteForUser').mockRejectedValueOnce(new Error('boom'))

        await expect(useCase.confirm(USER, token, 'source', 'target')).rejects.toThrow('boom')

        expect(world.snapshot()).toEqual(before)
        expect(world.audits).toHaveLength(0)
        spy.mockRestore()
    })

    it('is atomic: a failure while writing the audit undoes everything (no merge without an operationId)', async () => {
        const { world, useCase } = setup()
        const token = await dryRunToken(useCase)
        const before = world.snapshot()
        const spy = vi.spyOn(InMemoryAuditRepository.prototype, 'create').mockRejectedValueOnce(new Error('audit down'))

        await expect(useCase.confirm(USER, token, 'source', 'target')).rejects.toThrow('audit down')

        expect(world.snapshot()).toEqual(before)
        expect(world.category('source')).toBeDefined()
        spy.mockRestore()
    })

    it('merges a child into its own parent', async () => {
        const { world, useCase } = setup()
        world.addCategory({ id: 'p2', name: 'Moradia 2', userId: USER })
        world.addCategory({ id: 's2', name: 'Casa', userId: USER, parentId: 'p2' })
        world.addCategory({ id: 's2c', name: 'Reforma', userId: USER, parentId: 's2' })
        world.addTransaction({ id: 'tx-s2', userId: USER, categoryId: 's2' })

        const dry = await useCase.dryRun(USER, 's2', 'p2')
        expect(dry.canExecute).toBe(true)

        const result = await useCase.confirm(USER, dry.confirmationToken!, 's2', 'p2')

        expect(result.alreadyExecuted).toBe(false)
        expect(world.category('s2')).toBeUndefined()
        expect(world.category('s2c')!.parentId).toBe('p2')
        expect(world.transaction('tx-s2').categoryId).toBe('p2')
    })

    it('reports (instead of failing halfway on the database unique constraint) a child that shares the name of its own source living under the target', async () => {
        const { world, useCase } = setup()
        world.addCategory({ id: 'p2', name: 'Moradia 2', userId: USER })
        world.addCategory({ id: 's2', name: 'Casa', userId: USER, parentId: 'p2' })
        world.addCategory({ id: 's2c', name: 'Casa', userId: USER, parentId: 's2' })
        const before = world.snapshot()

        const dry = await useCase.dryRun(USER, 's2', 'p2')

        expect(dry.canExecute).toBe(false)
        expect(dry.confirmationToken).toBeNull()
        expect(dry.conflicts[0]).toMatchObject({ targetChildIsSource: true })
        expect(dry.message).toContain('a própria origem')
        expect(world.snapshot()).toEqual(before)
    })
})
