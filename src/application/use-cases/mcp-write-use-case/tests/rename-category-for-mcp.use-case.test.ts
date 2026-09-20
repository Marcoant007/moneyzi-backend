import { describe, it, expect, vi } from 'vitest'
import { RenameCategoryForMcpUseCase } from '../rename-category-for-mcp.use-case'
import { InMemoryAuditRepository, InMemoryCategoryUnitOfWork, InMemoryWorld } from './helpers/in-memory-category-world'

const USER = 'user-1'
const OTHER_USER = 'user-2'

function setup() {
    const world = new InMemoryWorld()
    world.addCategory({ id: 'aluguel', name: 'Aluguel Base ', userId: USER }) // espaço no final (legado)
    world.addCategory({ id: 'reserva', name: 'fundo de reserva ', userId: USER })
    world.addCategory({ id: 'moradia', name: 'Moradia', userId: USER })
    world.addCategory({ id: 'sub-a', name: 'Condomínio', userId: USER, parentId: 'moradia' })
    world.addCategory({ id: 'sub-b', name: 'IPTU', userId: USER, parentId: 'moradia' })
    world.addCategory({ id: 'other-cat', name: 'Aluguel Base ', userId: OTHER_USER })

    const uow = new InMemoryCategoryUnitOfWork(world)
    return { world, uow, useCase: new RenameCategoryForMcpUseCase(uow) }
}

describe('RenameCategoryForMcpUseCase', () => {
    it('applies trim and records an auditable, reversible operation', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'moradia', newName: '  Casa e Moradia  ' })

        expect(result).toMatchObject({ id: 'moradia', name: 'Casa e Moradia', previousName: 'Moradia', changed: true })
        expect(result.operationId).toBeTruthy()
        expect(world.category('moradia')!.name).toBe('Casa e Moradia')
        expect(world.audits).toHaveLength(1)
        expect(world.audits[0]).toMatchObject({
            id: result.operationId,
            userId: USER,
            tool: 'rename_category',
            previousState: { id: 'moradia', name: 'Moradia' },
            newState: { id: 'moradia', name: 'Casa e Moradia' },
        })
    })

    it('cleans up a legacy trailing space ("Aluguel Base " -> "Aluguel Base") without colliding with itself', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'aluguel', newName: 'Aluguel Base' })

        expect(result.changed).toBe(true)
        expect(world.category('aluguel')!.name).toBe('Aluguel Base')
    })

    it('allows changing only the case of its own name', async () => {
        const { world, useCase } = setup()

        await useCase.execute({ userId: USER, categoryId: 'reserva', newName: 'Fundo de Reserva' })

        expect(world.category('reserva')!.name).toBe('Fundo de Reserva')
    })

    it('rejects a name that already exists under the same parent, ignoring case and surrounding spaces', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'moradia', newName: 'ALUGUEL BASE' })).rejects.toThrow(/NAME_COLLISION.*aluguel/i)
        await expect(useCase.execute({ userId: USER, categoryId: 'sub-a', newName: 'iptu ' })).rejects.toThrow(/NAME_COLLISION/)

        expect(world.snapshot()).toEqual(before)
        expect(world.audits).toHaveLength(0)
    })

    it('allows the same name under a DIFFERENT parent', async () => {
        const { world, useCase } = setup()

        await useCase.execute({ userId: USER, categoryId: 'sub-a', newName: 'Moradia' })

        expect(world.category('sub-a')!.name).toBe('Moradia')
    })

    it('is a no-op (no audit, no operationId) when the name is already exactly that', async () => {
        const { world, useCase } = setup()

        const result = await useCase.execute({ userId: USER, categoryId: 'moradia', newName: ' Moradia ' })

        expect(result).toMatchObject({ changed: false, operationId: null, name: 'Moradia' })
        expect(world.audits).toHaveLength(0)
    })

    it('rejects an empty/blank or too long name', async () => {
        const { useCase } = setup()

        await expect(useCase.execute({ userId: USER, categoryId: 'moradia', newName: '   ' })).rejects.toThrow(/INVALID_NAME/)
        await expect(useCase.execute({ userId: USER, categoryId: 'moradia', newName: 'x'.repeat(101) })).rejects.toThrow(/INVALID_NAME/)
    })

    it('never touches another user\'s category — it simply does not exist for the caller', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()

        await expect(useCase.execute({ userId: USER, categoryId: 'other-cat', newName: 'Invadida' })).rejects.toThrow('Categoria não encontrada')
        await expect(useCase.execute({ userId: OTHER_USER, categoryId: 'moradia', newName: 'Invadida' })).rejects.toThrow('Categoria não encontrada')

        expect(world.snapshot()).toEqual(before)
    })

    it('refuses system categories', async () => {
        const { useCase } = setup()
        await expect(useCase.execute({ userId: USER, categoryId: 'system:SERVICES', newName: 'Serviços' })).rejects.toThrow(/SYSTEM_CATEGORY/)
    })

    it('is atomic: if the audit cannot be written the rename is undone', async () => {
        const { world, useCase } = setup()
        const before = world.snapshot()
        const spy = vi.spyOn(InMemoryAuditRepository.prototype, 'create').mockRejectedValueOnce(new Error('audit down'))

        await expect(useCase.execute({ userId: USER, categoryId: 'moradia', newName: 'Outra' })).rejects.toThrow('audit down')

        expect(world.snapshot()).toEqual(before)
        spy.mockRestore()
    })
})
