import { describe, it, expect, vi, afterEach } from 'vitest'
import { DeleteCategoryWithReassignmentUseCase } from '../delete-category-with-reassignment.use-case'
import { CategoryStructureRollback } from '@/application/use-cases/mcp-write-use-case/category-structure-rollback'
import {
    InMemoryCategoryRepository,
    InMemoryCategoryUnitOfWork,
    InMemoryWorld,
} from '@/application/use-cases/mcp-write-use-case/tests/helpers/in-memory-category-world'

const USER = 'user-1'
const OTHER_USER = 'user-2'

function setup() {
    const world = new InMemoryWorld()
    world.addCategory({ id: 'source', name: 'Pet', userId: USER, color: 'sky', icon: 'paw-print', createdAt: new Date('2026-02-02T10:00:00.000Z') })
    world.addCategory({ id: 'target', name: 'Outros', userId: USER })
    world.addCategory({ id: 'parent', name: 'Casa', userId: USER })
    world.addCategory({ id: 'kid', name: 'Luz', userId: USER, parentId: 'parent' })
    world.addCategory({ id: 'other-cat', name: 'Alheia', userId: OTHER_USER })

    world.addTransaction({ id: 'tx-1', userId: USER, categoryId: 'source' })
    world.addTransaction({ id: 'tx-2', userId: USER, categoryId: 'source' })
    world.addTransaction({ id: 'tx-trashed', userId: USER, categoryId: 'source', deletedAt: new Date('2026-02-01') })
    world.addTransaction({ id: 'tx-target', userId: USER, categoryId: 'target' })
    world.addTransaction({ id: 'tx-kid', userId: USER, categoryId: 'kid' })
    world.addTransaction({ id: 'tx-other', userId: OTHER_USER, categoryId: 'other-cat' })

    const uow = new InMemoryCategoryUnitOfWork(world)
    return {
        world,
        uow,
        useCase: new DeleteCategoryWithReassignmentUseCase(uow),
        rollback: new CategoryStructureRollback(uow),
    }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('DeleteCategoryWithReassignmentUseCase', () => {
    it('moves every transaction (soft-deleted included) to the target and deletes the source in ONE database transaction', async () => {
        const { world, uow, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })

        expect(result).toMatchObject({
            deletedCategoryId: 'source',
            reassignedToId: 'target',
            movedTransactionCount: 3,
        })
        expect(uow.runs).toBe(1)
        expect(world.category('source')).toBeUndefined()
        // a soft-deleted também foi movida — o FK ON DELETE SET NULL a teria orfanado
        for (const id of ['tx-1', 'tx-2', 'tx-trashed']) {
            expect(world.transaction(id).categoryId).toBe('target')
        }
        // nada além disso mudou
        expect(world.transaction('tx-target').categoryId).toBe('target')
        expect(world.transaction('tx-kid').categoryId).toBe('kid')
        expect(world.transaction('tx-other').categoryId).toBe('other-cat')
    })

    it('audits in the merge_categories format so the existing rollback can revert it', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })

        expect(world.audits).toHaveLength(1)
        expect(world.audits[0]).toMatchObject({
            id: result.operationId,
            userId: USER,
            tool: 'merge_categories',
            params: { sourceId: 'source', targetId: 'target', origin: 'app-delete' },
            previousState: {
                category: {
                    id: 'source',
                    name: 'Pet',
                    parentId: null,
                    createdAt: '2026-02-02T10:00:00.000Z',
                    color: 'sky',
                    icon: 'paw-print',
                },
                transactionIds: expect.arrayContaining(['tx-1', 'tx-2', 'tx-trashed']),
                childIds: [],
            },
            newState: { targetId: 'target' },
        })
    })

    it('refuses to delete a category that still has subcategories (nothing changes)', async () => {
        const { world, useCase } = setup()
        world.addTransaction({ id: 'tx-parent', userId: USER, categoryId: 'parent' })
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'parent', reassignToId: 'target' })).rejects.toThrow('Category has children')

        expect(world.snapshot()).toEqual(before)
    })

    it.each([
        ['the target is the category itself', { categoryId: 'source', reassignToId: 'source' }, /diferente/],
        ['the target does not exist', { categoryId: 'source', reassignToId: 'ghost' }, /destino não encontrada/],
        ["the target belongs to another user", { categoryId: 'source', reassignToId: 'other-cat' }, /destino não encontrada/],
        ["the source belongs to another user", { categoryId: 'other-cat', reassignToId: 'target' }, /Category not found/],
        ['the source does not exist', { categoryId: 'ghost', reassignToId: 'target' }, /Category not found/],
    ])('refuses when %s (nothing changes)', async (_label, ids, message) => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, ...ids })).rejects.toThrow(message)

        expect(world.snapshot()).toEqual(before)
    })

    it('is atomic: if the delete fails after the move, the move is rolled back too', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()
        vi.spyOn(InMemoryCategoryRepository.prototype, 'deleteForUser').mockResolvedValueOnce(false)

        await expect(useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })).rejects.toThrow('Category not found')

        expect(world.snapshot()).toEqual(before)
        expect(world.transaction('tx-1').categoryId).toBe('source')
        expect(world.audits).toHaveLength(0)
    })

    it('aborts (and undoes the move) when the moved count differs from what was read', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()
        vi.spyOn(InMemoryCategoryRepository.prototype, 'moveTransactionsToCategory').mockImplementationOnce(async () => 1)

        await expect(useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })).rejects.toThrow(/CONCURRENT_MODIFICATION/)

        expect(world.snapshot()).toEqual(before)
    })

    it('can be undone via the existing rollback: same id, same look, transactions back', async () => {
        const { world, useCase, rollback } = setup()
        const { operationId } = await useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })

        const result = await rollback.execute(USER, operationId)

        expect(result).toMatchObject({ rolledBack: true, restoredCategoryId: 'source', restoredTransactionCount: 3 })
        expect(world.category('source')).toMatchObject({
            id: 'source',
            name: 'Pet',
            color: 'sky',
            icon: 'paw-print',
            createdAt: new Date('2026-02-02T10:00:00.000Z'),
        })
        for (const id of ['tx-1', 'tx-2', 'tx-trashed']) {
            expect(world.transaction(id).categoryId).toBe('source')
        }
        expect(world.transaction('tx-target').categoryId).toBe('target')
    })

    it('undo never overwrites a change made after the delete', async () => {
        const { world, useCase, rollback } = setup()
        const { operationId } = await useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })
        world.transaction('tx-2').categoryId = 'parent' // o usuário mexeu depois

        const result = await rollback.execute(USER, operationId)

        expect(result.restoredTransactionCount).toBe(2)
        expect(result.skipped).toEqual([expect.objectContaining({ transactionId: 'tx-2' })])
        expect(world.transaction('tx-2').categoryId).toBe('parent')
    })

    it('undo is blocked (and changes nothing) if the original name was taken in the meantime', async () => {
        const { world, useCase, rollback } = setup()
        const { operationId } = await useCase.execute({ userId: USER, categoryId: 'source', reassignToId: 'target' })
        world.addCategory({ id: 'squatter', name: 'Pet', userId: USER })
        const before = world.snapshot()

        await expect(rollback.execute(USER, operationId)).rejects.toThrow(/ROLLBACK_BLOCKED/)

        expect(world.snapshot()).toEqual(before)
    })
})
