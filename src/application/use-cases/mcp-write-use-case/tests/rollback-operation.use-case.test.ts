import { describe, it, expect, vi } from 'vitest'
import { RollbackOperationUseCase } from '../rollback-operation.use-case'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'

function buildDeps() {
    const mcpAuditLogRepository = {
        findByIdForUser: vi.fn(),
        markRolledBack: vi.fn(),
    } as any
    const transactionRepository = {
        findManyByIdsWithCategory: vi.fn(),
        updateManyCategory: vi.fn(),
    } as any
    const categoryRepository = { findById: vi.fn(), hasChildren: vi.fn(), hasTransactions: vi.fn(), delete: vi.fn() } as any
    const deleteCategoryUseCase = new DeleteCategoryUseCase(categoryRepository)
    return { mcpAuditLogRepository, transactionRepository, categoryRepository, deleteCategoryUseCase }
}

describe('RollbackOperationUseCase', () => {
    it('rejects when the operation does not exist for this user', async () => {
        const deps = buildDeps()
        deps.mcpAuditLogRepository.findByIdForUser.mockResolvedValue(null)

        const useCase = new RollbackOperationUseCase(deps.mcpAuditLogRepository, deps.transactionRepository, deps.deleteCategoryUseCase)

        await expect(useCase.execute('user-1', 'op-missing')).rejects.toThrow('Operação não encontrada')
    })

    it('rejects when the operation was already rolled back', async () => {
        const deps = buildDeps()
        deps.mcpAuditLogRepository.findByIdForUser.mockResolvedValue({ id: 'op-1', tool: 'create_category', rolledBackAt: new Date() })

        const useCase = new RollbackOperationUseCase(deps.mcpAuditLogRepository, deps.transactionRepository, deps.deleteCategoryUseCase)

        await expect(useCase.execute('user-1', 'op-1')).rejects.toThrow('já foi revertida')
    })

    it('rolls back create_category by deleting the category, only if still empty', async () => {
        const deps = buildDeps()
        deps.mcpAuditLogRepository.findByIdForUser.mockResolvedValue({
            id: 'op-1', tool: 'create_category', rolledBackAt: null,
            newState: { id: 'cat-new' },
        })
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-new', userId: 'user-1' })
        deps.categoryRepository.hasChildren.mockResolvedValue(false)
        deps.categoryRepository.hasTransactions.mockResolvedValue(false)

        const useCase = new RollbackOperationUseCase(deps.mcpAuditLogRepository, deps.transactionRepository, deps.deleteCategoryUseCase)
        const result = await useCase.execute('user-1', 'op-1')

        expect(deps.categoryRepository.delete).toHaveBeenCalledWith('cat-new')
        expect(deps.mcpAuditLogRepository.markRolledBack).toHaveBeenCalledWith('op-1')
        expect(result.rolledBack).toBe(true)
    })

    it('propagates the error and does not mark rolled back when create_category rollback finds the category is no longer empty', async () => {
        const deps = buildDeps()
        deps.mcpAuditLogRepository.findByIdForUser.mockResolvedValue({
            id: 'op-1', tool: 'create_category', rolledBackAt: null,
            newState: { id: 'cat-new' },
        })
        deps.categoryRepository.findById.mockResolvedValue({ id: 'cat-new', userId: 'user-1' })
        deps.categoryRepository.hasChildren.mockResolvedValue(false)
        deps.categoryRepository.hasTransactions.mockResolvedValue(true)

        const useCase = new RollbackOperationUseCase(deps.mcpAuditLogRepository, deps.transactionRepository, deps.deleteCategoryUseCase)

        await expect(useCase.execute('user-1', 'op-1')).rejects.toThrow('Category has transactions')
        expect(deps.mcpAuditLogRepository.markRolledBack).not.toHaveBeenCalled()
    })

    it('reverts transaction moves whose current category still matches what the operation set, and skips the ones that drifted', async () => {
        const deps = buildDeps()
        deps.mcpAuditLogRepository.findByIdForUser.mockResolvedValue({
            id: 'op-2', tool: 'bulk_move_transactions', rolledBackAt: null,
            previousState: [
                { transactionId: 'tx-1', categoryId: null, category: 'TRANSPORTATION' },
                { transactionId: 'tx-2', categoryId: null, category: 'FOOD' },
            ],
            newState: [
                { transactionId: 'tx-1', categoryId: 'cat-1', category: 'OTHER' },
                { transactionId: 'tx-2', categoryId: 'cat-1', category: 'OTHER' },
            ],
        })
        // tx-1 ainda está em cat-1 (como a operação deixou) -> reverte.
        // tx-2 já foi movida manualmente pra cat-2 depois -> pula.
        deps.transactionRepository.findManyByIdsWithCategory.mockResolvedValue([
            { id: 'tx-1', categoryId: 'cat-1', category: 'OTHER' },
            { id: 'tx-2', categoryId: 'cat-2', category: 'OTHER' },
        ])

        const useCase = new RollbackOperationUseCase(deps.mcpAuditLogRepository, deps.transactionRepository, deps.deleteCategoryUseCase)
        const result = await useCase.execute('user-1', 'op-2')

        expect(deps.transactionRepository.updateManyCategory).toHaveBeenCalledWith(['tx-1'], 'user-1', { categoryId: null, category: 'TRANSPORTATION' })
        expect(deps.transactionRepository.updateManyCategory).toHaveBeenCalledTimes(1)
        expect(result.skipped).toEqual([{ transactionId: 'tx-2', reason: 'Categoria foi alterada manualmente depois da operação original' }])
        expect(deps.mcpAuditLogRepository.markRolledBack).toHaveBeenCalledWith('op-2')
    })
})
