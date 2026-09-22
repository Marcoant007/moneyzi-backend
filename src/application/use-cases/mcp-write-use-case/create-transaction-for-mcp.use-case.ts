import type { TransactionPaymentMethod, TransactionType } from '@prisma/client'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'
import type { ValidateTransactionBalanceUseCase } from '@/application/use-cases/transaction-use-case/validate-transaction-balance.use-case'
import { isSystemCategoryId } from '@/utils/system-category'

export interface CreateTransactionForMcpInput {
    userId: string
    name: string
    amount: number
    type: TransactionType
    /** Sempre uma categoria PERSONALIZADA real — mesma regra de bulk_move_transactions/move_transaction_category. */
    categoryId: string
    paymentMethod: TransactionPaymentMethod
    date: Date
    accountId?: string | null
    creditCardId?: string | null
    dueDate?: Date | null
    isRecurring?: boolean
}

export interface CreateTransactionForMcpResult {
    id: string
    name: string
    amount: number
    type: TransactionType
    categoryId: string
    paymentMethod: TransactionPaymentMethod
    date: Date
    accountId: string | null
    creditCardId: string | null
    operationId: string
}

/**
 * Cria um lançamento novo via MCP. Sempre exige categoria personalizada
 * (categorias de sistema não são aceitas aqui — mesma regra já usada em
 * bulk_move_transactions/move_transaction_category) e, se paymentMethod for
 * CREDIT_CARD, exige creditCardId também — nada é inferido silenciosamente,
 * pra forçar o agente de IA a perguntar em vez de adivinhar. A operação fica
 * auditada e pode ser desfeita com rollback_operation (RollbackOperationUseCase
 * simplesmente apaga a transação criada).
 */
export class CreateTransactionForMcpUseCase {
    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly categoryRepository: CategoryRepository,
        private readonly validateTransactionBalanceUseCase: ValidateTransactionBalanceUseCase,
        private readonly mcpAuditLogRepository: McpAuditLogRepository,
    ) { }

    async execute(input: CreateTransactionForMcpInput): Promise<CreateTransactionForMcpResult> {
        if (input.amount === 0) {
            throw new Error('amount não pode ser zero')
        }

        if (input.paymentMethod === 'CREDIT_CARD' && !input.creditCardId) {
            throw new Error('creditCardId é obrigatório quando paymentMethod é CREDIT_CARD')
        }

        if (isSystemCategoryId(input.categoryId)) {
            throw new Error('SYSTEM_CATEGORY: categorias de sistema não podem ser usadas aqui — escolha uma categoria personalizada (ver list_categories) ou crie uma com create_category')
        }

        const category = await this.categoryRepository.findById(input.categoryId)
        if (!category || category.userId !== input.userId) {
            throw new Error('Categoria não encontrada — use uma categoria personalizada (ver list_categories) ou crie uma com create_category')
        }

        if (input.accountId) {
            await this.validateTransactionBalanceUseCase.execute({
                userId: input.userId,
                accountId: input.accountId,
                type: input.type,
                amount: input.amount,
            })
        }

        const created = await this.transactionRepository.create({
            userId: input.userId,
            name: input.name.trim(),
            amount: input.amount,
            type: input.type,
            // category (enum legado) sempre 'OTHER' quando categoryId é uma categoria
            // personalizada real — mesma convenção de update-multiple-transactions.use-case.ts.
            category: 'OTHER',
            categoryId: input.categoryId,
            paymentMethod: input.paymentMethod,
            date: input.date,
            accountId: input.accountId ?? null,
            creditCardId: input.creditCardId ?? null,
            dueDate: input.dueDate ?? null,
            isRecurring: input.isRecurring ?? false,
            paymentStatus: 'PAID',
        })

        const auditLog = await this.mcpAuditLogRepository.create({
            userId: input.userId,
            tool: 'create_transaction',
            params: input,
            previousState: null,
            newState: { id: created.id },
        })

        return {
            id: created.id,
            name: created.name,
            amount: Number(created.amount),
            type: created.type,
            categoryId: created.categoryId ?? input.categoryId,
            paymentMethod: created.paymentMethod,
            date: created.date,
            accountId: created.accountId,
            creditCardId: created.creditCardId,
            operationId: auditLog.id,
        }
    }
}
