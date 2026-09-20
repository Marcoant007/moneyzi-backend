import { describe, it, expect, vi } from 'vitest'
import { MoveCategoryForMcpUseCase } from '../move-category-for-mcp.use-case'
import { InMemoryAuditRepository, InMemoryCategoryUnitOfWork, InMemoryWorld } from './helpers/in-memory-category-world'

const USER = 'user-1'
const OTHER_USER = 'user-2'

/**
 * Alimentação(1) -> Mercado(2) -> iFood(3)
 * Lazer(1)
 * Viagens(1) -> Hotéis(2)
 */
function setup() {
    const world = new InMemoryWorld()
    world.addCategory({ id: 'food', name: 'Alimentação', userId: USER })
    world.addCategory({ id: 'market', name: 'Mercado', userId: USER, parentId: 'food' })
    world.addCategory({ id: 'ifood', name: 'iFood', userId: USER, parentId: 'market' })
    world.addCategory({ id: 'fun', name: 'Lazer', userId: USER })
    world.addCategory({ id: 'trips', name: 'Viagens', userId: USER })
    world.addCategory({ id: 'hotels', name: 'Hotéis', userId: USER, parentId: 'trips' })
    world.addCategory({ id: 'other-root', name: 'Alheia', userId: OTHER_USER })
    world.addCategory({ id: 'other-child', name: 'Alheia filha', userId: OTHER_USER, parentId: 'other-root' })

    const uow = new InMemoryCategoryUnitOfWork(world)
    return { world, uow, useCase: new MoveCategoryForMcpUseCase(uow) }
}

describe('MoveCategoryForMcpUseCase', () => {
    it('moves a category (with its subtree) under a new parent and audits previous/new parent', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'market', newParentId: 'fun' })

        expect(result).toMatchObject({ id: 'market', previousParentId: 'food', newParentId: 'fun', changed: true })
        expect(world.category('market')!.parentId).toBe('fun')
        expect(world.category('ifood')!.parentId).toBe('market') // a subárvore acompanha
        expect(world.audits[0]).toMatchObject({
            id: result.operationId,
            tool: 'move_category',
            previousState: { id: 'market', parentId: 'food' },
            newState: { id: 'market', parentId: 'fun' },
        })
    })

    it('turns a category into a root with newParentId:null', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'hotels', newParentId: null })

        expect(result).toMatchObject({ previousParentId: 'trips', newParentId: null, changed: true })
        expect(world.category('hotels')!.parentId).toBeNull()
    })

    it('is a no-op (no audit, no operationId) when already under that parent', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'market', newParentId: 'food' })

        expect(result).toMatchObject({ changed: false, operationId: null })
        expect(world.audits).toHaveLength(0)
    })

    it('rejects moving a category under itself or under its own descendant (cycle)', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'food', newParentId: 'food' })).rejects.toThrow(/CYCLE/)
        await expect(useCase.execute({ userId: USER, categoryId: 'food', newParentId: 'market' })).rejects.toThrow(/CYCLE/)
        await expect(useCase.execute({ userId: USER, categoryId: 'food', newParentId: 'ifood' })).rejects.toThrow(/CYCLE/)

        expect(world.snapshot()).toEqual(before)
    })

    it('rejects a move that would exceed 3 levels, counting the moved category\'s descendants', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        // Mercado (+ iFood) tem altura 2; sob Hotéis (nível 2) chegaria a 4 níveis
        await expect(useCase.execute({ userId: USER, categoryId: 'market', newParentId: 'hotels' })).rejects.toThrow(/MAX_DEPTH_EXCEEDED/)
        // nada cabe embaixo de um nível 3
        await expect(useCase.execute({ userId: USER, categoryId: 'fun', newParentId: 'ifood' })).rejects.toThrow(/MAX_DEPTH_EXCEEDED/)

        expect(world.snapshot()).toEqual(before)
    })

    it('accepts a move that lands exactly on level 3', async () => {
        const { world, useCase } = setup()

        await useCase.execute({ userId: USER, categoryId: 'fun', newParentId: 'hotels' })

        expect(world.category('fun')!.parentId).toBe('hotels')
    })

    it('rejects a name collision under the new parent (case/space-insensitive) and when moving to root', async () => {
        const { world, useCase } = setup()
        world.addCategory({ id: 'fun-market', name: 'mercado ', userId: USER, parentId: 'fun' })
        world.addCategory({ id: 'root-hotels', name: 'HOTÉIS', userId: USER })
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'market', newParentId: 'fun' })).rejects.toThrow(/NAME_COLLISION/)
        await expect(useCase.execute({ userId: USER, categoryId: 'hotels', newParentId: null })).rejects.toThrow(/NAME_COLLISION/)

        expect(world.snapshot()).toEqual(before)
    })

    it('never touches another user\'s categories — on either side', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'other-child', newParentId: null })).rejects.toThrow('Categoria não encontrada')
        await expect(useCase.execute({ userId: USER, categoryId: 'fun', newParentId: 'other-root' })).rejects.toThrow('Categoria pai não encontrada')
        await expect(useCase.execute({ userId: OTHER_USER, categoryId: 'market', newParentId: null })).rejects.toThrow('Categoria não encontrada')

        expect(world.snapshot()).toEqual(before)
    })

    it('refuses system categories as the moved category or as the parent', async () => {
        const { useCase } = setup()

        await expect(useCase.execute({ userId: USER, categoryId: 'system:FOOD', newParentId: null })).rejects.toThrow(/SYSTEM_CATEGORY/)
        await expect(useCase.execute({ userId: USER, categoryId: 'fun', newParentId: 'system:FOOD' })).rejects.toThrow(/SYSTEM_CATEGORY/)
    })

    it('is atomic: if the audit cannot be written the move is undone', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()
        const spy = vi.spyOn(InMemoryAuditRepository.prototype, 'create').mockRejectedValueOnce(new Error('audit down'))

        await expect(useCase.execute({ userId: USER, categoryId: 'market', newParentId: 'fun' })).rejects.toThrow('audit down')

        expect(world.snapshot()).toEqual(before)
        spy.mockRestore()
    })
})
