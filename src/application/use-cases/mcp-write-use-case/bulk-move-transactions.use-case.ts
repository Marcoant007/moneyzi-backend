import { randomBytes } from 'node:crypto'
import type { TransactionCategory } from '@prisma/client'
import { redis } from '@/infra/cache/redis'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'
import type { McpTransactionFilter } from '@/application/repositories/transaction-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'

const MAX_TRANSACTIONS_PER_CALL = 500
const CONFIRMATION_TTL_SECONDS = 600

export interface BulkMoveTarget {
    transactionIds?: string[]
    filter?: {
        nameContains?: string
        currentCategoryId?: string
        dateFrom?: string
        dateTo?: string
    }
}

interface PendingBulkMove {
    userId: string
    transactionIds: string[]
    newCategoryId: string
    used: boolean
    operationId?: string
}

export interface BulkMovePreviewItem {
    id: string
    name: string
    amount: number
    date: Date
    previousCategoryId: string | null
}

export interface BulkMoveDryRunResult {
    preview: BulkMovePreviewItem[]
    count: number
    confirmationToken: string
    expiresInSeconds: number
}

export interface BulkMoveConfirmResult {
    updatedCount: number
    operationId: string
    alreadyExecuted: boolean
}

/**
 * dryRun nunca escreve nada — só resolve os alvos e guarda o conjunto exato
 * no Redis (TTL 10min) atrás de um token de uso único. confirm só aplica se
 * o mesmo filtro/ids resolverem pro MESMO conjunto de novo — se algo mudou
 * entre as duas chamadas, rejeita e pede um novo dryRun.
 */
export class BulkMoveTransactionsUseCase {
    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly categoryRepository: CategoryRepository,
        private readonly updateMultipleTransactionsUseCase: UpdateMultipleTransactionsUseCase,
        private readonly mcpAuditLogRepository: McpAuditLogRepository,
    ) { }

    async dryRun(userId: string, target: BulkMoveTarget, newCategoryId: string): Promise<BulkMoveDryRunResult> {
        await this.validateNewCategory(userId, newCategoryId)
        const targets = await this.resolveTargets(userId, target)

        const confirmationToken = randomBytes(24).toString('hex')
        const pending: PendingBulkMove = {
            userId,
            transactionIds: targets.map((t) => t.id).sort(),
            newCategoryId,
            used: false,
        }

        await redis.set(this.redisKey(confirmationToken), JSON.stringify(pending), 'EX', CONFIRMATION_TTL_SECONDS)

        return {
            preview: targets.map((t) => ({ id: t.id, name: t.name, amount: t.amount, date: t.date, previousCategoryId: t.categoryId })),
            count: targets.length,
            confirmationToken,
            expiresInSeconds: CONFIRMATION_TTL_SECONDS,
        }
    }

    async confirm(userId: string, confirmationToken: string, target: BulkMoveTarget, newCategoryId: string): Promise<BulkMoveConfirmResult> {
        const key = this.redisKey(confirmationToken)
        const raw = await redis.get(key)
        if (!raw) {
            throw new Error('CONFIRMATION_EXPIRED: token de confirmação inválido ou expirado — rode um novo dryRun (dryRun: true) antes de confirmar.')
        }

        const pending: PendingBulkMove = JSON.parse(raw)

        if (pending.userId !== userId) {
            throw new Error('Token de confirmação não pertence a este usuário')
        }

        if (pending.used) {
            return { updatedCount: 0, operationId: pending.operationId!, alreadyExecuted: true }
        }

        if (pending.newCategoryId !== newCategoryId) {
            throw new Error('CONFIRMATION_MISMATCH: a categoria de destino é diferente da usada no dry-run — rode um novo dryRun.')
        }

        const currentTargets = await this.resolveTargets(userId, target)
        const currentIds = currentTargets.map((t) => t.id).sort()
        const sameSet = currentIds.length === pending.transactionIds.length
            && currentIds.every((id, i) => id === pending.transactionIds[i])

        if (!sameSet) {
            throw new Error('CONFIRMATION_MISMATCH: o conjunto de transações mudou desde o dry-run (ex: uma nova transação chegou) — rode um novo dryRun.')
        }

        const previousState = currentTargets.map((t) => ({ transactionId: t.id, categoryId: t.categoryId, category: t.category }))
        const newState = currentTargets.map((t) => ({ transactionId: t.id, categoryId: newCategoryId, category: 'OTHER' as TransactionCategory }))

        const { updatedCount } = await this.updateMultipleTransactionsUseCase.execute({
            transactionIds: pending.transactionIds,
            categoryId: newCategoryId,
            userId,
        })

        const auditLog = await this.mcpAuditLogRepository.create({
            userId,
            tool: 'bulk_move_transactions',
            params: { target, newCategoryId },
            previousState,
            newState,
        })

        pending.used = true
        pending.operationId = auditLog.id
        await redis.set(key, JSON.stringify(pending), 'EX', CONFIRMATION_TTL_SECONDS)

        return { updatedCount, operationId: auditLog.id, alreadyExecuted: false }
    }

    private redisKey(confirmationToken: string): string {
        return `mcp:bulk-move:${confirmationToken}`
    }

    private async validateNewCategory(userId: string, newCategoryId: string): Promise<void> {
        const category = await this.categoryRepository.findById(newCategoryId)
        if (!category || category.userId !== userId) {
            throw new Error('Categoria de destino não encontrada')
        }
    }

    private async resolveTargets(userId: string, target: BulkMoveTarget) {
        if (target.transactionIds && target.transactionIds.length > 0) {
            return this.transactionRepository.findManyByIdsWithCategory(
                target.transactionIds.slice(0, MAX_TRANSACTIONS_PER_CALL),
                userId,
            )
        }

        const filter: McpTransactionFilter = {
            nameContains: target.filter?.nameContains,
            currentCategoryId: target.filter?.currentCategoryId,
            dateFrom: target.filter?.dateFrom ? new Date(target.filter.dateFrom) : undefined,
            dateTo: target.filter?.dateTo ? new Date(target.filter.dateTo) : undefined,
        }

        return this.transactionRepository.findManyByFilter(userId, filter, MAX_TRANSACTIONS_PER_CALL)
    }
}
