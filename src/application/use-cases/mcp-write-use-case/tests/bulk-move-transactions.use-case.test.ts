import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'

const store = new Map<string, string>()

vi.mock('@/infra/cache/redis', () => ({
    redis: {
        set: vi.fn(async (key: string, value: string) => {
            store.set(key, value)
            return 'OK'
        }),
        get: vi.fn(async (key: string) => store.get(key) ?? null),
    },
}))

function buildDeps() {
    const transactionRepository = {
        findManyByIdsWithCategory: vi.fn(),
        findManyByFilter: vi.fn(),
        updateManyCategory: vi.fn(),
    } as any
    const categoryRepository = { findById: vi.fn() } as any
    const mcpAuditLogRepository = { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) } as any
    const updateMultipleTransactionsUseCase = new UpdateMultipleTransactionsUseCase(transactionRepository)
    return { transactionRepository, categoryRepository, mcpAuditLogRepository, updateMultipleTransactionsUseCase }
}

const TX_1 = { id: 'tx-1', name: 'Uber', amount: 20, date: new Date('2026-03-01'), categoryId: null, category: 'TRANSPORTATION' }
const TX_2 = { id: 'tx-2', name: 'Uber Eats', amount: 30, date: new Date('2026-03-02'), categoryId: null, category: 'FOOD' }

describe('BulkMoveTransactionsUseCase', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    it('dryRun never mutates anything and returns a confirmationToken', async () => {
        const { BulkMoveTransactionsUseCase } = await import('../bulk-move-transactions.use-case')
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-1', userId: 'user-1' })
        deps.transactionRepository.findManyByFilter.mockResolvedValue([TX_1, TX_2])

        const useCase = new BulkMoveTransactionsUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)
        const result = await useCase.dryRun('user-1', { filter: { nameContains: 'uber' } }, 'cat-1')

        expect(result.count).toBe(2)
        expect(result.confirmationToken).toMatch(/^[0-9a-f]{48}$/)
        expect(deps.transactionRepository.updateManyCategory).not.toHaveBeenCalled()
        expect(deps.mcpAuditLogRepository.create).not.toHaveBeenCalled()
    })

    it('confirm rejects an unknown/expired confirmationToken', async () => {
        const { BulkMoveTransactionsUseCase } = await import('../bulk-move-transactions.use-case')
        const deps = buildDeps()
        const useCase = new BulkMoveTransactionsUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)

        await expect(useCase.confirm('user-1', 'never-issued-token', {}, 'cat-1')).rejects.toThrow(/CONFIRMATION_EXPIRED/)
    })

    it('confirm rejects when the resolved transaction set changed since the dry-run', async () => {
        const { BulkMoveTransactionsUseCase } = await import('../bulk-move-transactions.use-case')
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-1', userId: 'user-1' })
        deps.transactionRepository.findManyByFilter.mockResolvedValueOnce([TX_1])

        const useCase = new BulkMoveTransactionsUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)
        const dryRunResult = await useCase.dryRun('user-1', { filter: { nameContains: 'uber' } }, 'cat-1')

        // Uma nova transação "chegou" entre o dry-run e a confirmação
        deps.transactionRepository.findManyByFilter.mockResolvedValueOnce([TX_1, TX_2])

        await expect(
            useCase.confirm('user-1', dryRunResult.confirmationToken, { filter: { nameContains: 'uber' } }, 'cat-1'),
        ).rejects.toThrow(/CONFIRMATION_MISMATCH/)
        expect(deps.transactionRepository.updateManyCategory).not.toHaveBeenCalled()
    })

    it('confirm applies the move, writes audit with full previous/new state, and is idempotent on a repeated call', async () => {
        const { BulkMoveTransactionsUseCase } = await import('../bulk-move-transactions.use-case')
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-1', userId: 'user-1' })
        deps.transactionRepository.findManyByFilter.mockResolvedValue([TX_1, TX_2])
        deps.transactionRepository.findManyByIdsWithCategory.mockResolvedValue([TX_1, TX_2])
        deps.transactionRepository.updateManyCategory.mockResolvedValue(2)

        const useCase = new BulkMoveTransactionsUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)
        const dryRunResult = await useCase.dryRun('user-1', { filter: { nameContains: 'uber' } }, 'cat-1')

        const first = await useCase.confirm('user-1', dryRunResult.confirmationToken, { filter: { nameContains: 'uber' } }, 'cat-1')

        expect(first.alreadyExecuted).toBe(false)
        expect(first.updatedCount).toBe(2)
        expect(deps.mcpAuditLogRepository.create).toHaveBeenCalledWith({
            userId: 'user-1',
            tool: 'bulk_move_transactions',
            params: { target: { filter: { nameContains: 'uber' } }, newCategoryId: 'cat-1' },
            previousState: [
                { transactionId: 'tx-1', categoryId: null, category: 'TRANSPORTATION' },
                { transactionId: 'tx-2', categoryId: null, category: 'FOOD' },
            ],
            newState: [
                { transactionId: 'tx-1', categoryId: 'cat-1', category: 'OTHER' },
                { transactionId: 'tx-2', categoryId: 'cat-1', category: 'OTHER' },
            ],
        })

        // segunda confirmação com o MESMO token: não reaplica, não duplica auditoria
        const second = await useCase.confirm('user-1', dryRunResult.confirmationToken, { filter: { nameContains: 'uber' } }, 'cat-1')
        expect(second.alreadyExecuted).toBe(true)
        expect(second.operationId).toBe(first.operationId)
        expect(deps.mcpAuditLogRepository.create).toHaveBeenCalledTimes(1)
        expect(deps.transactionRepository.updateManyCategory).toHaveBeenCalledTimes(1)
    })
})

describe('BulkMoveTransactionsUseCase — new filters, system categories and preview', () => {
    beforeEach(() => {
        store.clear()
        vi.clearAllMocks()
    })

    async function build() {
        const { BulkMoveTransactionsUseCase } = await import('../bulk-move-transactions.use-case')
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-1', userId: 'user-1' })
        deps.transactionRepository.findManyByFilter.mockResolvedValue([TX_1])
        const useCase = new BulkMoveTransactionsUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)
        return { deps, useCase }
    }

    function manyTransactions(count: number) {
        return Array.from({ length: count }, (_, i) => ({
            id: `tx-${String(i).padStart(4, '0')}`,
            name: `Compra ${i}`,
            amount: 10 + i,
            date: new Date('2026-03-01'),
            categoryId: i % 2 === 0 ? 'cat-old' : null,
            category: 'OTHER',
            categoryName: i % 2 === 0 ? 'Antiga' : undefined,
        }))
    }

    it('keeps the old filter contract: only the old fields resolve to the same repository call (new ones are simply absent)', async () => {
        const { deps, useCase } = await build()

        await useCase.dryRun('user-1', { filter: { nameContains: 'uber', currentCategoryId: 'cat-9', dateFrom: '2026-03-01', dateTo: '2026-03-31' } }, 'cat-1')

        expect(deps.transactionRepository.findManyByFilter).toHaveBeenCalledWith(
            'user-1',
            {
                nameContains: 'uber',
                currentCategoryId: 'cat-9',
                dateFrom: new Date('2026-03-01'),
                dateTo: new Date('2026-03-31'),
            },
            500,
        )
    })

    it('passes nameContainsAny (trimmed, blanks dropped), paymentMethod, type and the amount range down to the repository', async () => {
        const { deps, useCase } = await build()

        await useCase.dryRun('user-1', {
            filter: { nameContainsAny: [' iptu ', 'seguro', '  '], paymentMethod: 'BANK_SLIP', type: 'EXPENSE', amountMin: 50, amountMax: 900 },
        }, 'cat-1')

        expect(deps.transactionRepository.findManyByFilter).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                nameContainsAny: ['iptu', 'seguro'],
                paymentMethod: 'BANK_SLIP',
                type: 'EXPENSE',
                amountMin: 50,
                amountMax: 900,
            }),
            500,
        )
    })

    it('accepts an amountMin of 0 (falsy but valid) and one-sided ranges', async () => {
        const { deps, useCase } = await build()

        await useCase.dryRun('user-1', { filter: { amountMin: 0 } }, 'cat-1')

        const filter = deps.transactionRepository.findManyByFilter.mock.calls[0][1]
        expect(filter.amountMin).toBe(0)
        expect(filter).not.toHaveProperty('amountMax')
    })

    it('rejects an inverted amount range and a nameContainsAny made only of blanks', async () => {
        const { deps, useCase } = await build()

        await expect(useCase.dryRun('user-1', { filter: { amountMin: 100, amountMax: 10 } }, 'cat-1')).rejects.toThrow('amountMin não pode ser maior que amountMax.')
        await expect(useCase.dryRun('user-1', { filter: { nameContainsAny: ['  ', ''] } }, 'cat-1')).rejects.toThrow(/nameContainsAny/)
        expect(deps.transactionRepository.findManyByFilter).not.toHaveBeenCalled()
    })

    it('turns a system category id in currentCategoryId into a system-category filter (not a custom id)', async () => {
        const { deps, useCase } = await build()

        await useCase.dryRun('user-1', { filter: { currentCategoryId: 'system:SERVICES' } }, 'cat-1')

        const filter = deps.transactionRepository.findManyByFilter.mock.calls[0][1]
        expect(filter.currentSystemCategory).toBe('SERVICES')
        expect(filter).not.toHaveProperty('currentCategoryId')
    })

    it('rejects an unknown system category id', async () => {
        const { useCase } = await build()

        await expect(useCase.dryRun('user-1', { filter: { currentCategoryId: 'system:NOT_REAL' } }, 'cat-1')).rejects.toThrow(/Categoria de sistema desconhecida/)
    })

    it('refuses a system category as the DESTINATION with an explanatory error', async () => {
        const { deps, useCase } = await build()

        await expect(useCase.dryRun('user-1', { filter: { nameContains: 'x' } }, 'system:FOOD')).rejects.toThrow(/SYSTEM_CATEGORY/)
        expect(deps.transactionRepository.findManyByFilter).not.toHaveBeenCalled()
    })

    it('lists id, name, amount, date and the CURRENT category (name) per transaction, falling back to the system enum', async () => {
        const { deps, useCase } = await build()
        deps.transactionRepository.findManyByFilter.mockResolvedValue([
            { id: 'tx-a', name: 'Iptu', amount: 120.5, date: new Date('2026-03-05'), categoryId: 'cat-old', category: 'OTHER', categoryName: 'Impostos' },
            { id: 'tx-b', name: 'Faxina', amount: 200, date: new Date('2026-03-06'), categoryId: null, category: 'SERVICES', categoryName: 'SERVICES' },
            { id: 'tx-c', name: 'Legado', amount: 5, date: new Date('2026-03-07'), categoryId: null, category: 'FOOD' }, // sem categoryName
        ])

        const result = await useCase.dryRun('user-1', { filter: { nameContains: 'x' } }, 'cat-1')

        expect(result.preview).toEqual([
            { id: 'tx-a', name: 'Iptu', amount: 120.5, date: new Date('2026-03-05'), previousCategoryId: 'cat-old', previousCategoryName: 'Impostos' },
            { id: 'tx-b', name: 'Faxina', amount: 200, date: new Date('2026-03-06'), previousCategoryId: null, previousCategoryName: 'SERVICES' },
            { id: 'tx-c', name: 'Legado', amount: 5, date: new Date('2026-03-07'), previousCategoryId: null, previousCategoryName: 'FOOD' },
        ])
        expect(result.count).toBe(3)
        expect(result.previewTruncated).toBe(false)
    })

    it('over the display limit, lists only the first 50 but reports the TOTAL — and the token still covers all of them', async () => {
        const { deps, useCase } = await build()
        const all = manyTransactions(120)
        deps.transactionRepository.findManyByFilter.mockResolvedValue(all)
        deps.transactionRepository.updateManyCategory.mockResolvedValue(120)

        const dry = await useCase.dryRun('user-1', { filter: { nameContains: 'compra' } }, 'cat-1')

        expect(dry.count).toBe(120)
        expect(dry.preview).toHaveLength(50)
        expect(dry.preview.map((p) => p.id)).toEqual(all.slice(0, 50).map((t) => t.id))
        expect(dry.previewLimit).toBe(50)
        expect(dry.previewTruncated).toBe(true)
        expect(dry.limitReached).toBe(false)

        // a confirmação vale pro conjunto INTEIRO, não só pro que foi exibido
        deps.transactionRepository.findManyByIdsWithCategory.mockResolvedValue(all)
        const confirm = await useCase.confirm('user-1', dry.confirmationToken, { filter: { nameContains: 'compra' } }, 'cat-1')
        expect(confirm.updatedCount).toBe(120)
        expect(deps.transactionRepository.updateManyCategory.mock.calls[0][0]).toHaveLength(120)
    })

    it('flags limitReached when the 500-per-call limit is hit, and does not truncate when at or under 50', async () => {
        const { deps, useCase } = await build()

        deps.transactionRepository.findManyByFilter.mockResolvedValue(manyTransactions(500))
        const capped = await useCase.dryRun('user-1', { filter: { nameContains: 'compra' } }, 'cat-1')
        expect(capped).toMatchObject({ count: 500, limitReached: true, previewTruncated: true })

        deps.transactionRepository.findManyByFilter.mockResolvedValue(manyTransactions(50))
        const exact = await useCase.dryRun('user-1', { filter: { nameContains: 'compra' } }, 'cat-1')
        expect(exact).toMatchObject({ count: 50, limitReached: false, previewTruncated: false })
        expect(exact.preview).toHaveLength(50)
    })

    it('still caps an explicit id list at 500 per call', async () => {
        const { deps, useCase } = await build()
        deps.transactionRepository.findManyByIdsWithCategory.mockResolvedValue([])

        await useCase.dryRun('user-1', { transactionIds: Array.from({ length: 800 }, (_, i) => `tx-${i}`) }, 'cat-1')

        expect(deps.transactionRepository.findManyByIdsWithCategory.mock.calls[0][0]).toHaveLength(500)
    })

    it('confirm re-validates the destination: a category deleted/merged after the dry-run gives a clear error, not an FK failure', async () => {
        const { deps, useCase } = await build()
        const dry = await useCase.dryRun('user-1', { filter: { nameContains: 'uber' } }, 'cat-1')

        deps.categoryRepository.findById.mockResolvedValue(null) // categoria de destino sumiu (merge/delete)

        await expect(
            useCase.confirm('user-1', dry.confirmationToken, { filter: { nameContains: 'uber' } }, 'cat-1'),
        ).rejects.toThrow('Categoria de destino não encontrada')
        expect(deps.transactionRepository.updateManyCategory).not.toHaveBeenCalled()
        expect(deps.mcpAuditLogRepository.create).not.toHaveBeenCalled()
    })
})
