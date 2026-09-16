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
