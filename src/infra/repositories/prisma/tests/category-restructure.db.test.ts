/**
 * Testes de integração CONTRA UM POSTGRES REAL — o que os testes em memória não
 * conseguem provar: o ON DELETE SET NULL de verdade, a unique de irmãs, o
 * rollback da transação e o isolamento Serializable.
 *
 * DESLIGADOS por padrão. Só rodam com TEST_DATABASE_URL apontando pra um Postgres
 * LOCAL e DESCARTÁVEL (host localhost/127.0.0.1/host.docker.internal/postgres).
 * Qualquer outro host derruba a suíte de propósito — nunca aponte isto pro Neon
 * de produção.
 *
 *   docker run --rm -d --name moneyzi-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=moneyzi_test postgres:16
 *   DATABASE_URL=postgresql://postgres:test@localhost:55432/moneyzi_test pnpm prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/moneyzi_test pnpm vitest run src/infra/repositories/prisma/tests/category-restructure.db.test.ts
 *
 * (as migrations já existentes bastam — nenhuma migration nova é necessária.)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const SAFE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal', 'postgres'])

if (TEST_DATABASE_URL) {
    const host = new URL(TEST_DATABASE_URL).hostname
    if (!SAFE_HOSTS.has(host)) {
        throw new Error(
            `TEST_DATABASE_URL aponta pra "${host}", que não é um Postgres local/descartável. ` +
            'Estes testes apagam e recriam dados: recusando rodar. Use um container local (ver o topo do arquivo).',
        )
    }
}

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

describe.skipIf(!TEST_DATABASE_URL)('category restructuring against a real Postgres', () => {
    let prisma: typeof import('@/lib/prisma')['prisma']
    let PrismaCategoryUnitOfWork: typeof import('../prisma-category-unit-of-work')['PrismaCategoryUnitOfWork']
    let PrismaCategoryRepository: typeof import('../prisma-category-repository')['PrismaCategoryRepository']
    let PrismaMcpAuditLogRepository: typeof import('../prisma-mcp-audit-log-repository')['PrismaMcpAuditLogRepository']
    let MergeCategoriesUseCase: typeof import('@/application/use-cases/mcp-write-use-case/merge-categories.use-case')['MergeCategoriesUseCase']
    let DeleteCategoryForMcpUseCase: typeof import('@/application/use-cases/mcp-write-use-case/delete-category-for-mcp.use-case')['DeleteCategoryForMcpUseCase']
    let RenameCategoryForMcpUseCase: typeof import('@/application/use-cases/mcp-write-use-case/rename-category-for-mcp.use-case')['RenameCategoryForMcpUseCase']
    let CategoryStructureRollback: typeof import('@/application/use-cases/mcp-write-use-case/category-structure-rollback')['CategoryStructureRollback']

    const originalDatabaseUrl = process.env.DATABASE_URL
    const userId = `test-user-${randomUUID()}`

    beforeAll(async () => {
        // O singleton de @/lib/prisma lê DATABASE_URL ao ser criado — aponta pro banco de teste antes de importar.
        process.env.DATABASE_URL = TEST_DATABASE_URL
        ;({ prisma } = await import('@/lib/prisma'))
        ;({ PrismaCategoryUnitOfWork } = await import('../prisma-category-unit-of-work'))
        ;({ PrismaCategoryRepository } = await import('../prisma-category-repository'))
        ;({ PrismaMcpAuditLogRepository } = await import('../prisma-mcp-audit-log-repository'))
        ;({ MergeCategoriesUseCase } = await import('@/application/use-cases/mcp-write-use-case/merge-categories.use-case'))
        ;({ DeleteCategoryForMcpUseCase } = await import('@/application/use-cases/mcp-write-use-case/delete-category-for-mcp.use-case'))
        ;({ RenameCategoryForMcpUseCase } = await import('@/application/use-cases/mcp-write-use-case/rename-category-for-mcp.use-case'))
        ;({ CategoryStructureRollback } = await import('@/application/use-cases/mcp-write-use-case/category-structure-rollback'))

        await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: 'Teste de integração' } })
    })

    afterAll(async () => {
        if (prisma) {
            // Category, Transaction e McpAuditLog têm onDelete: Cascade a partir do User.
            await prisma.user.deleteMany({ where: { id: userId } })
            await prisma.$disconnect()
        }
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
        else process.env.DATABASE_URL = originalDatabaseUrl
    })

    async function makeCategory(name: string, parentId: string | null = null) {
        return prisma.category.create({ data: { name, userId, parentId } })
    }

    async function makeTransaction(categoryId: string | null, extra: { deletedAt?: Date } = {}) {
        return prisma.transaction.create({
            data: {
                name: 'Compra de teste',
                type: 'EXPENSE',
                amount: '10.00',
                category: 'OTHER',
                paymentMethod: 'PIX',
                date: new Date('2026-03-10T12:00:00.000Z'),
                userId,
                categoryId,
                deletedAt: extra.deletedAt ?? null,
            },
        })
    }

    function buildMerge() {
        return new MergeCategoriesUseCase(new PrismaCategoryRepository(), new PrismaCategoryUnitOfWork())
    }

    it('PREMISE: both foreign keys are ON DELETE SET NULL — a bare delete silently orphans transactions (soft-deleted too) and subcategories', async () => {
        const doomed = await makeCategory(`premissa-${randomUUID()}`)
        const child = await makeCategory(`filha-${randomUUID()}`, doomed.id)
        const active = await makeTransaction(doomed.id)
        const trashed = await makeTransaction(doomed.id, { deletedAt: new Date('2026-02-01') })

        await prisma.category.delete({ where: { id: doomed.id } }) // sem nenhum cuidado

        expect((await prisma.category.findUnique({ where: { id: child.id } }))!.parentId).toBeNull()
        expect((await prisma.transaction.findUnique({ where: { id: active.id } }))!.categoryId).toBeNull()
        expect((await prisma.transaction.findUnique({ where: { id: trashed.id } }))!.categoryId).toBeNull()
    })

    it('merge moves every transaction (soft-deleted included), re-points the subtree, deletes the source and audits — nothing orphaned', async () => {
        const source = await makeCategory(`origem-${randomUUID()}`)
        const target = await makeCategory(`destino-${randomUUID()}`)
        const child = await makeCategory(`filha-${randomUUID()}`, source.id)
        const grandchild = await makeCategory(`neta-${randomUUID()}`, child.id)
        const txActive = await makeTransaction(source.id)
        const txTrashed = await makeTransaction(source.id, { deletedAt: new Date('2026-02-01') })
        const useCase = buildMerge()

        const dry = await useCase.dryRun(userId, source.id, target.id)
        expect(dry).toMatchObject({ canExecute: true, transactionCount: 2, softDeletedTransactionCount: 1 })
        const result = await useCase.confirm(userId, dry.confirmationToken!, source.id, target.id)

        expect(await prisma.category.findUnique({ where: { id: source.id } })).toBeNull()
        expect((await prisma.transaction.findUnique({ where: { id: txActive.id } }))!.categoryId).toBe(target.id)
        expect((await prisma.transaction.findUnique({ where: { id: txTrashed.id } }))!.categoryId).toBe(target.id)
        expect((await prisma.category.findUnique({ where: { id: child.id } }))!.parentId).toBe(target.id)
        expect((await prisma.category.findUnique({ where: { id: grandchild.id } }))!.parentId).toBe(child.id)

        const audit = await prisma.mcpAuditLog.findUnique({ where: { id: result.operationId } })
        expect(audit).toMatchObject({ tool: 'merge_categories', userId })
        expect((audit!.previousState as any).transactionIds.sort()).toEqual([txActive.id, txTrashed.id].sort())
    })

    it('merge is ONE database transaction: a failure while writing the audit rolls the moves back for real', async () => {
        const source = await makeCategory(`origem-${randomUUID()}`)
        const target = await makeCategory(`destino-${randomUUID()}`)
        const child = await makeCategory(`filha-${randomUUID()}`, source.id)
        const tx = await makeTransaction(source.id)
        const useCase = buildMerge()
        const dry = await useCase.dryRun(userId, source.id, target.id)
        const spy = vi.spyOn(PrismaMcpAuditLogRepository.prototype, 'create').mockRejectedValueOnce(new Error('audit down'))

        await expect(useCase.confirm(userId, dry.confirmationToken!, source.id, target.id)).rejects.toThrow('audit down')
        spy.mockRestore()

        expect(await prisma.category.findUnique({ where: { id: source.id } })).not.toBeNull()
        expect((await prisma.transaction.findUnique({ where: { id: tx.id } }))!.categoryId).toBe(source.id)
        expect((await prisma.category.findUnique({ where: { id: child.id } }))!.parentId).toBe(source.id)
    })

    it('rollback of a merge recreates the source with the SAME uuid and createdAt and restores what it moved', async () => {
        const source = await makeCategory(`origem-${randomUUID()}`)
        const target = await makeCategory(`destino-${randomUUID()}`)
        const child = await makeCategory(`filha-${randomUUID()}`, source.id)
        const tx = await makeTransaction(source.id)
        const useCase = buildMerge()
        const dry = await useCase.dryRun(userId, source.id, target.id)
        const merged = await useCase.confirm(userId, dry.confirmationToken!, source.id, target.id)

        const rollback = new CategoryStructureRollback(new PrismaCategoryUnitOfWork())
        const result = await rollback.execute(userId, merged.operationId)

        expect(result).toMatchObject({ rolledBack: true, restoredCategoryId: source.id, restoredTransactionCount: 1, restoredSubcategoryCount: 1 })
        const restored = await prisma.category.findUnique({ where: { id: source.id } })
        expect(restored).toMatchObject({ id: source.id, name: source.name, parentId: null })
        expect(restored!.createdAt).toEqual(source.createdAt)
        expect((await prisma.transaction.findUnique({ where: { id: tx.id } }))!.categoryId).toBe(source.id)
        expect((await prisma.category.findUnique({ where: { id: child.id } }))!.parentId).toBe(source.id)
        expect((await prisma.mcpAuditLog.findUnique({ where: { id: merged.operationId } }))!.rolledBackAt).not.toBeNull()
    })

    it('two concurrent confirms of the same merge never both apply (the second fails cleanly)', async () => {
        const source = await makeCategory(`origem-${randomUUID()}`)
        const target = await makeCategory(`destino-${randomUUID()}`)
        await makeTransaction(source.id)
        const useCase = buildMerge()
        const dry = await useCase.dryRun(userId, source.id, target.id)

        const outcomes = await Promise.allSettled([
            useCase.confirm(userId, dry.confirmationToken!, source.id, target.id),
            useCase.confirm(userId, dry.confirmationToken!, source.id, target.id),
        ])

        const fulfilled = outcomes.filter((o) => o.status === 'fulfilled') as PromiseFulfilledResult<any>[]
        const applied = fulfilled.filter((o) => o.value.alreadyExecuted === false)
        expect(applied).toHaveLength(1)
        expect(await prisma.mcpAuditLog.count({ where: { userId, tool: 'merge_categories', params: { equals: { sourceId: source.id, targetId: target.id } } } })).toBe(1)
    })

    it('delete refuses a category that only has soft-deleted transactions (the FK would null them)', async () => {
        const category = await makeCategory(`lixeira-${randomUUID()}`)
        const trashed = await makeTransaction(category.id, { deletedAt: new Date('2026-02-01') })
        const useCase = new DeleteCategoryForMcpUseCase(new PrismaCategoryUnitOfWork())

        await expect(useCase.execute({ userId, categoryId: category.id })).rejects.toThrow(/CATEGORY_IN_USE/)

        expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull()
        expect((await prisma.transaction.findUnique({ where: { id: trashed.id } }))!.categoryId).toBe(category.id)
    })

    it('delete + rollback round-trips an empty category under its parent with the same id', async () => {
        const parent = await makeCategory(`pai-${randomUUID()}`)
        const empty = await makeCategory(`vazia-${randomUUID()}`, parent.id)
        const remove = new DeleteCategoryForMcpUseCase(new PrismaCategoryUnitOfWork())

        const deleted = await remove.execute({ userId, categoryId: empty.id })
        expect(await prisma.category.findUnique({ where: { id: empty.id } })).toBeNull()

        await new CategoryStructureRollback(new PrismaCategoryUnitOfWork()).execute(userId, deleted.operationId)

        expect(await prisma.category.findUnique({ where: { id: empty.id } })).toMatchObject({ id: empty.id, name: empty.name, parentId: parent.id })
    })

    it('rename trims a legacy trailing space and rejects a case-insensitive collision under the same parent', async () => {
        const suffix = randomUUID()
        const legacy = await makeCategory(`Aluguel Base ${suffix} `)
        await makeCategory(`fundo ${suffix}`)
        const useCase = new RenameCategoryForMcpUseCase(new PrismaCategoryUnitOfWork())

        const renamed = await useCase.execute({ userId, categoryId: legacy.id, newName: `Aluguel Base ${suffix}` })
        expect(renamed.changed).toBe(true)
        expect((await prisma.category.findUnique({ where: { id: legacy.id } }))!.name).toBe(`Aluguel Base ${suffix}`)

        await expect(useCase.execute({ userId, categoryId: legacy.id, newName: `FUNDO ${suffix} ` })).rejects.toThrow(/NAME_COLLISION/)
    })
})
