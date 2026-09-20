import { describe, it, expect, vi } from 'vitest'
import { DeleteCategoryForMcpUseCase } from '../delete-category-for-mcp.use-case'
import { InMemoryAuditRepository, InMemoryCategoryUnitOfWork, InMemoryWorld } from './helpers/in-memory-category-world'

const USER = 'user-1'
const OTHER_USER = 'user-2'

function setup() {
    const world = new InMemoryWorld()
    world.addCategory({ id: 'empty', name: 'Vazia', userId: USER, createdAt: new Date('2026-02-02T10:00:00.000Z') })
    world.addCategory({ id: 'with-tx', name: 'Com transação', userId: USER })
    world.addCategory({ id: 'only-trashed', name: 'Só na lixeira', userId: USER })
    world.addCategory({ id: 'parent', name: 'Pai', userId: USER })
    world.addCategory({ id: 'kid-1', name: 'Filha 1', userId: USER, parentId: 'parent' })
    world.addCategory({ id: 'kid-2', name: 'Filha 2', userId: USER, parentId: 'parent' })
    world.addCategory({ id: 'other-empty', name: 'Alheia vazia', userId: OTHER_USER })

    world.addTransaction({ id: 'tx-1', userId: USER, categoryId: 'with-tx' })
    world.addTransaction({ id: 'tx-trash', userId: USER, categoryId: 'only-trashed', deletedAt: new Date('2026-02-01') })

    const uow = new InMemoryCategoryUnitOfWork(world)
    return { world, uow, useCase: new DeleteCategoryForMcpUseCase(uow) }
}

describe('DeleteCategoryForMcpUseCase', () => {
    it('deletes an empty category and audits a full snapshot (enough to recreate it with the same id)', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'empty' })

        expect(result).toMatchObject({ deletedCategoryId: 'empty', name: 'Vazia' })
        expect(world.category('empty')).toBeUndefined()
        expect(world.audits[0]).toMatchObject({
            id: result.operationId,
            userId: USER,
            tool: 'delete_category',
            previousState: { category: { id: 'empty', name: 'Vazia', parentId: null, createdAt: '2026-02-02T10:00:00.000Z' } },
            newState: { deleted: true },
        })
    })

    it('refuses when the category has transactions and says what to do', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        const error = await useCase.execute({ userId: USER, categoryId: 'with-tx' }).catch((e: Error) => e)

        expect((error as Error).message).toMatch(/CATEGORY_IN_USE/)
        expect((error as Error).message).toContain('1 transação(ões)')
        expect((error as Error).message).toContain('merge_categories')
        expect((error as Error).message).toContain('bulk_move_transactions')
        expect(world.snapshot()).toEqual(before)
    })

    it('refuses when the category has subcategories, naming them', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        const error = (await useCase.execute({ userId: USER, categoryId: 'parent' }).catch((e: Error) => e)) as Error

        expect(error.message).toMatch(/CATEGORY_IN_USE/)
        expect(error.message).toContain('2 subcategoria(s)')
        expect(error.message).toContain('"Filha 1"')
        expect(error.message).toContain('move_category')
        expect(world.snapshot()).toEqual(before)
    })

    it('counts soft-deleted transactions too: the FK is ON DELETE SET NULL and would silently null them', async () => {
        const { world, useCase } = setup()

        const error = (await useCase.execute({ userId: USER, categoryId: 'only-trashed' }).catch((e: Error) => e)) as Error

        expect(error.message).toMatch(/CATEGORY_IN_USE/)
        expect(error.message).toContain('1 já excluída(s)')
        expect(world.category('only-trashed')).toBeDefined()
        expect(world.transaction('tx-trash').categoryId).toBe('only-trashed')
    })

    it('never deletes another user\'s category', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'other-empty' })).rejects.toThrow('Categoria não encontrada')
        await expect(useCase.execute({ userId: OTHER_USER, categoryId: 'empty' })).rejects.toThrow('Categoria não encontrada')

        expect(world.snapshot()).toEqual(before)
    })

    it('refuses system categories', async () => {
        const { useCase } = setup()
        await expect(useCase.execute({ userId: USER, categoryId: 'system:OTHER' })).rejects.toThrow(/SYSTEM_CATEGORY/)
    })

    it('is atomic: if the audit cannot be written the category is NOT deleted', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()
        const spy = vi.spyOn(InMemoryAuditRepository.prototype, 'create').mockRejectedValueOnce(new Error('audit down'))

        await expect(useCase.execute({ userId: USER, categoryId: 'empty' })).rejects.toThrow('audit down')

        expect(world.snapshot()).toEqual(before)
        expect(world.category('empty')).toBeDefined()
        spy.mockRestore()
    })
})
