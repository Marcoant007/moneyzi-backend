import { describe, it, expect, vi } from 'vitest'
import { CreateTransactionForMcpUseCase } from '../create-transaction-for-mcp.use-case'

function buildDeps() {
    const transactionRepository = { create: vi.fn() } as any
    const categoryRepository = { findById: vi.fn() } as any
    const validateTransactionBalanceUseCase = { execute: vi.fn().mockResolvedValue(undefined) } as any
    const mcpAuditLogRepository = { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) } as any
    return { transactionRepository, categoryRepository, validateTransactionBalanceUseCase, mcpAuditLogRepository }
}

const baseInput = {
    userId: 'user-1',
    name: 'Compra no mercado',
    amount: 50,
    type: 'EXPENSE' as const,
    categoryId: 'cat-1',
    paymentMethod: 'PIX' as const,
    date: new Date('2026-02-10'),
}

const ownedCategory = { id: 'cat-1', userId: 'user-1', name: 'Mercado', parentId: null }

describe('CreateTransactionForMcpUseCase', () => {
    it('rejects amount zero', async () => {
        const deps = buildDeps()
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(useCase.execute({ ...baseInput, amount: 0 })).rejects.toThrow('amount não pode ser zero')
        expect(deps.categoryRepository.findById).not.toHaveBeenCalled()
        expect(deps.transactionRepository.create).not.toHaveBeenCalled()
    })

    it('requires creditCardId when paymentMethod is CREDIT_CARD', async () => {
        const deps = buildDeps()
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(
            useCase.execute({ ...baseInput, paymentMethod: 'CREDIT_CARD' }),
        ).rejects.toThrow('creditCardId é obrigatório')
        expect(deps.transactionRepository.create).not.toHaveBeenCalled()
    })

    it('accepts CREDIT_CARD when creditCardId is provided', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue(ownedCategory)
        deps.transactionRepository.create.mockResolvedValue({
            id: 'tx-1', name: 'Compra no mercado', amount: 50, type: 'EXPENSE',
            category: 'OTHER', categoryId: 'cat-1', paymentMethod: 'CREDIT_CARD',
            date: baseInput.date, accountId: null, creditCardId: 'card-1',
        })
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(
            useCase.execute({ ...baseInput, paymentMethod: 'CREDIT_CARD', creditCardId: 'card-1' }),
        ).resolves.toMatchObject({ id: 'tx-1' })
    })

    it('rejects a system category id without even hitting the repository', async () => {
        const deps = buildDeps()
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(
            useCase.execute({ ...baseInput, categoryId: 'system:FOOD' }),
        ).rejects.toThrow('SYSTEM_CATEGORY')
        expect(deps.categoryRepository.findById).not.toHaveBeenCalled()
        expect(deps.transactionRepository.create).not.toHaveBeenCalled()
    })

    it('rejects an unknown category id', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue(null)
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(useCase.execute(baseInput)).rejects.toThrow('Categoria não encontrada')
        expect(deps.transactionRepository.create).not.toHaveBeenCalled()
    })

    it("rejects a category that belongs to a different user", async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue({ ...ownedCategory, userId: 'someone-else' })
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(useCase.execute(baseInput)).rejects.toThrow('Categoria não encontrada')
        expect(deps.transactionRepository.create).not.toHaveBeenCalled()
    })

    it('propagates INSUFFICIENT_BALANCE from the balance validator and never creates the transaction', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue(ownedCategory)
        deps.validateTransactionBalanceUseCase.execute.mockRejectedValue(new Error('INSUFFICIENT_BALANCE'))
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await expect(
            useCase.execute({ ...baseInput, accountId: 'acc-1' }),
        ).rejects.toThrow('INSUFFICIENT_BALANCE')
        expect(deps.transactionRepository.create).not.toHaveBeenCalled()
    })

    it('does not validate balance when no accountId is provided', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue(ownedCategory)
        deps.transactionRepository.create.mockResolvedValue({
            id: 'tx-1', name: 'Compra no mercado', amount: 50, type: 'EXPENSE',
            category: 'OTHER', categoryId: 'cat-1', paymentMethod: 'PIX',
            date: baseInput.date, accountId: null, creditCardId: null,
        })
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        await useCase.execute(baseInput)

        expect(deps.validateTransactionBalanceUseCase.execute).not.toHaveBeenCalled()
    })

    it('happy path: creates with category=OTHER + the real categoryId, audits with previousState null, and returns operationId', async () => {
        const deps = buildDeps()
        deps.categoryRepository.findById.mockResolvedValue(ownedCategory)
        deps.transactionRepository.create.mockResolvedValue({
            id: 'tx-1', name: 'Compra no mercado', amount: 50, type: 'EXPENSE',
            category: 'OTHER', categoryId: 'cat-1', paymentMethod: 'PIX',
            date: baseInput.date, accountId: 'acc-1', creditCardId: null,
        })
        const useCase = new CreateTransactionForMcpUseCase(deps.transactionRepository, deps.categoryRepository, deps.validateTransactionBalanceUseCase, deps.mcpAuditLogRepository)

        const result = await useCase.execute({ ...baseInput, accountId: 'acc-1' })

        expect(deps.validateTransactionBalanceUseCase.execute).toHaveBeenCalledWith({
            userId: 'user-1', accountId: 'acc-1', type: 'EXPENSE', amount: 50,
        })
        expect(deps.transactionRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'OTHER', categoryId: 'cat-1', paymentStatus: 'PAID' }),
        )
        expect(deps.mcpAuditLogRepository.create).toHaveBeenCalledWith({
            userId: 'user-1',
            tool: 'create_transaction',
            params: expect.objectContaining({ accountId: 'acc-1' }),
            previousState: null,
            newState: { id: 'tx-1' },
        })
        expect(result.operationId).toBe('audit-1')
        expect(result.id).toBe('tx-1')
    })
})
