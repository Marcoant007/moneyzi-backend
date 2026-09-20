import { randomBytes } from 'node:crypto'
import type { TransactionCategory, TransactionPaymentMethod } from '@prisma/client'
import { redis } from '@/infra/cache/redis'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'
import type { McpTransactionFilter } from '@/application/repositories/transaction-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'
import { isSystemCategoryId, parseSystemCategoryId } from '@/utils/system-category'

const MAX_TRANSACTIONS_PER_CALL = 500
const CONFIRMATION_TTL_SECONDS = 600
/** Quantas transações o dry-run lista uma a uma; o resto entra só na contagem (count). */
const PREVIEW_DISPLAY_LIMIT = 50

export interface BulkMoveTarget {
    transactionIds?: string[]
    filter?: {
        nameContains?: string
        /** OR entre os termos (case-insensitive). Entre campos diferentes vale AND. */
        nameContainsAny?: string[]
        /** Id de uma categoria personalizada ou de sistema (`system:<ENUM>`, ver list_categories). */
        currentCategoryId?: string
        paymentMethod?: TransactionPaymentMethod
        type?: 'EXPENSE' | 'DEPOSIT'
        amountMin?: number
        amountMax?: number
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
    /** Categoria atual da transação: a personalizada, ou o enum de sistema (ex.: "SERVICES"). */
    previousCategoryName: string
}

export interface BulkMoveDryRunResult {
    /** As primeiras `previewLimit` transações afetadas; o total real está em `count`. */
    preview: BulkMovePreviewItem[]
    /** Total de transações que serão afetadas (não só as listadas em `preview`). */
    count: number
    previewLimit: number
    previewTruncated: boolean
    /** true quando `count` bateu o limite de 500 por chamada — pode haver mais; repita depois de confirmar. */
    limitReached: boolean
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
            preview: targets.slice(0, PREVIEW_DISPLAY_LIMIT).map((t) => ({
                id: t.id,
                name: t.name,
                amount: t.amount,
                date: t.date,
                previousCategoryId: t.categoryId,
                previousCategoryName: t.categoryName ?? t.category,
            })),
            count: targets.length,
            previewLimit: PREVIEW_DISPLAY_LIMIT,
            previewTruncated: targets.length > PREVIEW_DISPLAY_LIMIT,
            limitReached: targets.length >= MAX_TRANSACTIONS_PER_CALL,
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

        // A categoria de destino pode ter sido apagada/mesclada entre o dry-run e a
        // confirmação (merge_categories/delete_category) — erro claro em vez de FK.
        await this.validateNewCategory(userId, newCategoryId)

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
        if (isSystemCategoryId(newCategoryId)) {
            throw new Error('SYSTEM_CATEGORY: categorias de sistema (isSystem:true) não podem ser destino — escolha uma categoria personalizada (ver list_categories).')
        }

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

        return this.transactionRepository.findManyByFilter(userId, this.buildFilter(target.filter), MAX_TRANSACTIONS_PER_CALL)
    }

    private buildFilter(input: BulkMoveTarget['filter']): McpTransactionFilter {
        const filter: McpTransactionFilter = {
            nameContains: input?.nameContains,
            dateFrom: input?.dateFrom ? new Date(input.dateFrom) : undefined,
            dateTo: input?.dateTo ? new Date(input.dateTo) : undefined,
        }

        if (input?.nameContainsAny) {
            const terms = input.nameContainsAny.map((term) => term.trim()).filter((term) => term.length > 0)
            if (terms.length === 0) {
                throw new Error('nameContainsAny precisa de pelo menos um termo não vazio.')
            }
            filter.nameContainsAny = terms
        }

        if (input?.currentCategoryId) {
            if (isSystemCategoryId(input.currentCategoryId)) {
                const systemCategory = parseSystemCategoryId(input.currentCategoryId)
                if (!systemCategory) {
                    throw new Error(`Categoria de sistema desconhecida: "${input.currentCategoryId}" (ver list_categories, isSystem:true).`)
                }
                filter.currentSystemCategory = systemCategory
            } else {
                filter.currentCategoryId = input.currentCategoryId
            }
        }

        if (input?.paymentMethod) filter.paymentMethod = input.paymentMethod
        if (input?.type) filter.type = input.type

        if (input?.amountMin !== undefined && input?.amountMax !== undefined && input.amountMin > input.amountMax) {
            throw new Error('amountMin não pode ser maior que amountMax.')
        }
        if (input?.amountMin !== undefined) filter.amountMin = input.amountMin
        if (input?.amountMax !== undefined) filter.amountMax = input.amountMax

        return filter
    }
}
