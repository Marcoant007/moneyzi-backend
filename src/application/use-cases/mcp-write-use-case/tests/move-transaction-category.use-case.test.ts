import { describe, it, expect, vi } from 'vitest'
import { MoveTransactionCategoryUseCase } from '../move-transaction-category.use-case'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'

function buildDeps() {
    const transactionRepository = {
        findManyByIdsWithCategory: vi.fn(),
        updateManyCategory: vi.fn(),
    } as any
    const categoryRepository = { findById: vi.fn() } as any
    const mcpAuditLogRepository = { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) } as any
    const updateMultipleTransactionsUseCase = new UpdateMultipleTransactionsUseCase(transactionRepository)
    return { transactionRepository, categoryRepository, mcpAuditLogRepository, updateMultipleTransactionsUseCase }
}

describe('MoveTransactionCategoryUseCase', () => {
    it('rejects when the destination category does not belong to the user', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-1', userId: 'someone-else' })

        const useCase = new MoveTransactionCategoryUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)

        await expect(useCase.execute({ userId: 'user-1', transactionId: 'tx-1', newCategoryId: 'cat-1' })).rejects.toThrow('Categoria de destino não encontrada')
    })

    it('rejects when the transaction is not found for this user', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-1', userId: 'user-1' })
        deps.transactionRepository.findManyByIdsWithCategory.mockResolvedValue([])

        const useCase = new MoveTransactionCategoryUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)

        await expect(useCase.execute({ userId: 'user-1', transactionId: 'tx-1', newCategoryId: 'cat-1' })).rejects.toThrow('Transação não encontrada')
    })

    it('snapshots the previous category, applies the move, and writes an audit log with both category and categoryId', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-2', userId: 'user-1' })
        deps.transactionRepository.findManyByIdsWithCategory.mockResolvedValue([
            { id: 'tx-1', name: 'Uber', amount: 20, date: new Date(), categoryId: 'cat-1', category: 'TRANSPORTATION' },
        ])
        deps.transactionRepository.updateManyCategory.mockResolvedValue(1)

        const useCase = new MoveTransactionCategoryUseCase(deps.transactionRepository, deps.categoryRepository, deps.updateMultipleTransactionsUseCase, deps.mcpAuditLogRepository)
        const result = await useCase.execute({ userId: 'user-1', transactionId: 'tx-1', newCategoryId: 'cat-2' })

        expect(deps.transactionRepository.updateManyCategory).toHaveBeenCalledWith(['tx-1'], 'user-1', { categoryId: 'cat-2', category: 'OTHER' })
        expect(deps.mcpAuditLogRepository.create).toHaveBeenCalledWith({
            userId: 'user-1',
            tool: 'move_transaction_category',
            params: { transactionId: 'tx-1', newCategoryId: 'cat-2' },
            previousState: [{ transactionId: 'tx-1', categoryId: 'cat-1', category: 'TRANSPORTATION' }],
            newState: [{ transactionId: 'tx-1', categoryId: 'cat-2', category: 'OTHER' }],
        })
        expect(result.previousCategoryId).toBe('cat-1')
        expect(result.operationId).toBe('audit-1')
    })
})
