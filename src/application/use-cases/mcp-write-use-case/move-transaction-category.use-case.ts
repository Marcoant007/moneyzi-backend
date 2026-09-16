import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'

export interface MoveTransactionCategoryInput {
    userId: string
    transactionId: string
    newCategoryId: string
}

export interface MoveTransactionCategoryResult {
    id: string
    name: string
    previousCategoryId: string | null
    newCategoryId: string
    operationId: string
}

export class MoveTransactionCategoryUseCase {
    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly categoryRepository: CategoryRepository,
        private readonly updateMultipleTransactionsUseCase: UpdateMultipleTransactionsUseCase,
        private readonly mcpAuditLogRepository: McpAuditLogRepository,
    ) { }

    async execute(input: MoveTransactionCategoryInput): Promise<MoveTransactionCategoryResult> {
        const category = await this.categoryRepository.findById(input.newCategoryId)
        if (!category || category.userId !== input.userId) {
            throw new Error('Categoria de destino não encontrada')
        }

        const [transaction] = await this.transactionRepository.findManyByIdsWithCategory([input.transactionId], input.userId)
        if (!transaction) {
            throw new Error('Transação não encontrada')
        }

        const previousCategoryId = transaction.categoryId

        const { updatedCount } = await this.updateMultipleTransactionsUseCase.execute({
            transactionIds: [input.transactionId],
            categoryId: input.newCategoryId,
            userId: input.userId,
        })

        if (updatedCount === 0) {
            throw new Error('Não foi possível atualizar a transação')
        }

        const auditLog = await this.mcpAuditLogRepository.create({
            userId: input.userId,
            tool: 'move_transaction_category',
            params: { transactionId: input.transactionId, newCategoryId: input.newCategoryId },
            previousState: [{ transactionId: input.transactionId, categoryId: previousCategoryId, category: transaction.category }],
            newState: [{ transactionId: input.transactionId, categoryId: input.newCategoryId, category: 'OTHER' }],
        })

        return {
            id: transaction.id,
            name: transaction.name,
            previousCategoryId,
            newCategoryId: input.newCategoryId,
            operationId: auditLog.id,
        }
    }
}
