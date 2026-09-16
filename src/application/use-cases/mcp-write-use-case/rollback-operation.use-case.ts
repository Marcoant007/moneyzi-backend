import type { TransactionCategory } from '@prisma/client'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'

interface TransactionMoveEntry {
    transactionId: string
    categoryId: string | null
    category: TransactionCategory
}

export interface RollbackResult {
    operationId: string
    tool: string
    rolledBack: boolean
    skipped: Array<{ transactionId: string; reason: string }>
}

/**
 * Reverte pro estado salvo em previousState. Pra create_category, só
 * funciona se a categoria continuar vazia (reaproveita DeleteCategoryUseCase,
 * que já bloqueia se tiver filhos/transações). Pra reclassificações, só
 * reverte transações cujo categoryId atual ainda seja o que a operação
 * original definiu — se alguém mudou de novo depois, pula e reporta,
 * nunca sobrescreve uma mudança manual posterior.
 */
export class RollbackOperationUseCase {
    constructor(
        private readonly mcpAuditLogRepository: McpAuditLogRepository,
        private readonly transactionRepository: TransactionRepository,
        private readonly deleteCategoryUseCase: DeleteCategoryUseCase,
    ) { }

    async execute(userId: string, operationId: string): Promise<RollbackResult> {
        const log = await this.mcpAuditLogRepository.findByIdForUser(operationId, userId)
        if (!log) {
            throw new Error('Operação não encontrada')
        }
        if (log.rolledBackAt) {
            throw new Error('Operação já foi revertida')
        }

        let skipped: Array<{ transactionId: string; reason: string }> = []

        if (log.tool === 'create_category') {
            const newState = log.newState as { id: string }
            await this.deleteCategoryUseCase.execute({ id: newState.id, userId })
        } else if (log.tool === 'move_transaction_category' || log.tool === 'bulk_move_transactions') {
            skipped = await this.rollbackTransactionMoves(userId, log.previousState as TransactionMoveEntry[], log.newState as TransactionMoveEntry[])
        } else {
            throw new Error(`Rollback não suportado para a ferramenta "${log.tool}"`)
        }

        await this.mcpAuditLogRepository.markRolledBack(operationId)

        return { operationId, tool: log.tool, rolledBack: true, skipped }
    }

    private async rollbackTransactionMoves(
        userId: string,
        previousEntries: TransactionMoveEntry[],
        newEntries: TransactionMoveEntry[],
    ): Promise<Array<{ transactionId: string; reason: string }>> {
        const newById = new Map(newEntries.map((e) => [e.transactionId, e]))
        const ids = previousEntries.map((e) => e.transactionId)

        const currentTransactions = await this.transactionRepository.findManyByIdsWithCategory(ids, userId)
        const currentById = new Map(currentTransactions.map((t) => [t.id, t]))

        const skipped: Array<{ transactionId: string; reason: string }> = []
        const groups = new Map<string, { categoryId: string | null; category: TransactionCategory; transactionIds: string[] }>()

        for (const entry of previousEntries) {
            const current = currentById.get(entry.transactionId)
            if (!current) {
                skipped.push({ transactionId: entry.transactionId, reason: 'Transação não encontrada' })
                continue
            }

            const expected = newById.get(entry.transactionId)
            if (!expected || current.categoryId !== expected.categoryId) {
                skipped.push({ transactionId: entry.transactionId, reason: 'Categoria foi alterada manualmente depois da operação original' })
                continue
            }

            const groupKey = `${entry.categoryId ?? 'null'}::${entry.category}`
            const group = groups.get(groupKey) ?? { categoryId: entry.categoryId, category: entry.category, transactionIds: [] }
            group.transactionIds.push(entry.transactionId)
            groups.set(groupKey, group)
        }

        for (const group of groups.values()) {
            await this.transactionRepository.updateManyCategory(group.transactionIds, userId, {
                categoryId: group.categoryId,
                category: group.category,
            })
        }

        return skipped
    }
}
