import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoryController } from '@/application/controllers/category-controller'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const OPERATION = '33333333-3333-4333-8333-333333333333'

function makeReply() {
    const reply = {
        status: vi.fn(),
        send: vi.fn(),
    } as any

    reply.status.mockReturnValue(reply)
    reply.send.mockReturnValue(reply)
    return reply
}

describe('CategoryController', () => {
    const createUseCase = { execute: vi.fn() }
    const updateUseCase = { execute: vi.fn() }
    const deleteUseCase = { execute: vi.fn() }
    const reassignUseCase = { execute: vi.fn() }
    const rollback = { execute: vi.fn() }

    const controller = new CategoryController(
        createUseCase as any,
        { execute: vi.fn() } as any,
        { execute: vi.fn() } as any,
        updateUseCase as any,
        deleteUseCase as any,
        reassignUseCase as any,
        rollback as any,
    )

    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('create / update with color and icon', () => {
        it('forwards color and icon to the use case', async () => {
            createUseCase.execute.mockResolvedValue({ id: UUID_A })
            const reply = makeReply()

            await controller.create({ headers: { 'x-user-id': 'user-1' }, body: { name: 'Pet', color: 'sky', icon: 'paw-print' } } as any, reply)

            expect(createUseCase.execute).toHaveBeenCalledWith({ name: 'Pet', userId: 'user-1', parentId: undefined, color: 'sky', icon: 'paw-print' })
            expect(reply.status).toHaveBeenCalledWith(201)
        })

        it('accepts null to clear on update and rejects a malformed key', async () => {
            updateUseCase.execute.mockResolvedValue({ id: UUID_A })

            await controller.update({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, body: { name: 'Pet', color: null, icon: null } } as any, makeReply())
            expect(updateUseCase.execute).toHaveBeenCalledWith(expect.objectContaining({ color: null, icon: null }))

            await expect(
                controller.update({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, body: { name: 'Pet', color: '<script>' } } as any, makeReply()),
            ).rejects.toThrow()
        })
    })

    describe('DELETE /categories/:id', () => {
        it('without reassignTo keeps the old behavior (204, blocked when it has transactions)', async () => {
            deleteUseCase.execute.mockResolvedValue(undefined)
            const ok = makeReply()
            await controller.delete({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, query: {} } as any, ok)
            expect(ok.status).toHaveBeenCalledWith(204)
            expect(reassignUseCase.execute).not.toHaveBeenCalled()

            deleteUseCase.execute.mockRejectedValue(new Error('Category has transactions'))
            const blocked = makeReply()
            await controller.delete({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, query: {} } as any, blocked)
            expect(blocked.status).toHaveBeenCalledWith(400)
        })

        it('with reassignTo moves and deletes atomically through the new use case (200 + operationId)', async () => {
            reassignUseCase.execute.mockResolvedValue({ operationId: OPERATION, deletedCategoryId: UUID_A, reassignedToId: UUID_B, movedTransactionCount: 4 })
            const reply = makeReply()

            await controller.delete({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, query: { reassignTo: UUID_B } } as any, reply)

            expect(reassignUseCase.execute).toHaveBeenCalledWith({ userId: 'user-1', categoryId: UUID_A, reassignToId: UUID_B })
            expect(deleteUseCase.execute).not.toHaveBeenCalled()
            expect(reply.status).toHaveBeenCalledWith(200)
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ operationId: OPERATION, movedTransactionCount: 4 }))
        })

        it.each([
            ['Category not found', 404],
            ['Category has children', 400],
            ['Categoria de destino não encontrada', 400],
            ['CONCURRENT_MODIFICATION: mudou', 409],
        ])('maps "%s" to %i when reassigning', async (message, status) => {
            reassignUseCase.execute.mockRejectedValue(new Error(message))
            const reply = makeReply()

            await controller.delete({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, query: { reassignTo: UUID_B } } as any, reply)

            expect(reply.status).toHaveBeenCalledWith(status)
        })

        it('rejects a malformed reassignTo without touching anything', async () => {
            const reply = makeReply()

            await controller.delete({ headers: { 'x-user-id': 'user-1' }, params: { id: UUID_A }, query: { reassignTo: 'nope' } } as any, reply)

            expect(reply.status).toHaveBeenCalledWith(400)
            expect(reassignUseCase.execute).not.toHaveBeenCalled()
            expect(deleteUseCase.execute).not.toHaveBeenCalled()
        })

        it('requires the user header', async () => {
            const reply = makeReply()
            await controller.delete({ headers: {}, params: { id: UUID_A }, query: { reassignTo: UUID_B } } as any, reply)
            expect(reply.status).toHaveBeenCalledWith(401)
        })
    })

    describe('POST /categories/operations/:operationId/rollback', () => {
        it('reverts the operation scoped to the calling user', async () => {
            rollback.execute.mockResolvedValue({ operationId: OPERATION, rolledBack: true, restoredCategoryId: UUID_A })
            const reply = makeReply()

            await controller.rollbackOperation({ headers: { 'x-user-id': 'user-1' }, params: { operationId: OPERATION } } as any, reply)

            expect(rollback.execute).toHaveBeenCalledWith('user-1', OPERATION)
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ rolledBack: true }))
        })

        it.each([
            ['Operação não encontrada', 404],
            ['Operação já foi revertida', 409],
            ['ROLLBACK_BLOCKED: nome ocupado', 409],
            ['CONCURRENT_MODIFICATION: mudou', 409],
            ['Rollback não suportado para a ferramenta "x"', 400],
        ])('maps "%s" to %i', async (message, status) => {
            rollback.execute.mockRejectedValue(new Error(message))
            const reply = makeReply()

            await controller.rollbackOperation({ headers: { 'x-user-id': 'user-1' }, params: { operationId: OPERATION } } as any, reply)

            expect(reply.status).toHaveBeenCalledWith(status)
        })

        it('rejects a malformed operation id and a missing user', async () => {
            const bad = makeReply()
            await controller.rollbackOperation({ headers: { 'x-user-id': 'user-1' }, params: { operationId: 'x' } } as any, bad)
            expect(bad.status).toHaveBeenCalledWith(400)

            const anonymous = makeReply()
            await controller.rollbackOperation({ headers: {}, params: { operationId: OPERATION } } as any, anonymous)
            expect(anonymous.status).toHaveBeenCalledWith(401)
            expect(rollback.execute).not.toHaveBeenCalled()
        })
    })
})
