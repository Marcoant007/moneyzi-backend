import { randomBytes } from 'node:crypto'
import { redis } from '@/infra/cache/redis'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { CategoryUnitOfWork } from '@/application/repositories/category-unit-of-work'
import {
    computeMergeFingerprint,
    describeDepthViolations,
    describeMergeConflicts,
    planMerge,
    type MergeConflict,
    type MergePlan,
} from '@/utils/category-structure'
import { assertNotSystemCategoryId } from '@/utils/system-category'
import { snapshotCategory, type MergeNewState, type MergePreviousState } from './category-operation-states'

const CONFIRMATION_TTL_SECONDS = 600

interface PendingMerge {
    userId: string
    sourceId: string
    targetId: string
    fingerprint: string
    used: boolean
    operationId?: string
}

export interface MergeCategoriesDryRunResult {
    source: { id: string; name: string }
    target: { id: string; name: string }
    /** Todas as transações que serão movidas — inclui as soft-deleted, que o FK zeraria ao apagar a origem. */
    transactionCount: number
    softDeletedTransactionCount: number
    reparentedSubcategories: Array<{ id: string; name: string }>
    conflicts: MergeConflict[]
    /** false quando há conflito de nome: nenhum token é emitido e a execução seria recusada. */
    canExecute: boolean
    confirmationToken: string | null
    expiresInSeconds: number | null
    message: string
}

export interface MergeCategoriesConfirmResult {
    operationId: string
    movedTransactionCount: number
    reparentedSubcategoryCount: number
    deletedCategoryId: string
    alreadyExecuted: boolean
}

/**
 * Junta `source` em `target`: move as transações, reaponta as subcategorias e
 * apaga `source` — tudo numa transação de banco só, com a auditoria dentro
 * dela. O FK das duas relações é ON DELETE SET NULL, então a ordem
 * (mover → reapontar → apagar) é o que impede orfanar dados em silêncio.
 *
 * Mesmo protocolo do BulkMoveTransactionsUseCase: dryRun nunca escreve no banco
 * e devolve um confirmationToken de uso único (Redis, TTL 10min); confirm só
 * executa se o conjunto afetado ainda for exatamente o do dry-run.
 */
export class MergeCategoriesUseCase {
    constructor(
        private readonly categoryRepository: CategoryRepository,
        private readonly unitOfWork: CategoryUnitOfWork,
    ) { }

    async dryRun(userId: string, sourceId: string, targetId: string): Promise<MergeCategoriesDryRunResult> {
        this.assertNotSystem(sourceId, targetId)

        const categories = await this.categoryRepository.listByUserId(userId)
        const plan = planMerge(categories, sourceId, targetId)
        this.assertDepthOk(plan)

        const transactions = await this.categoryRepository.listTransactionRefs(userId, sourceId)
        const softDeleted = transactions.filter((t) => t.deleted).length

        const summary = {
            source: { id: plan.source.id, name: plan.source.name },
            target: { id: plan.target.id, name: plan.target.name },
            transactionCount: transactions.length,
            softDeletedTransactionCount: softDeleted,
            reparentedSubcategories: plan.childrenToReparent.map((c) => ({ id: c.id, name: c.name })),
            conflicts: plan.conflicts,
        }

        if (plan.conflicts.length > 0) {
            return {
                ...summary,
                canExecute: false,
                confirmationToken: null,
                expiresInSeconds: null,
                message:
                    `MERGE_CONFLICT: subcategoria(s) da origem com o mesmo nome de subcategoria do destino: ${describeMergeConflicts(plan.conflicts)}. ` +
                    'Nada foi alterado e nenhum confirmationToken foi emitido. Resolva antes — renomeie uma das duas (rename_category), ' +
                    'mova uma delas (move_category) ou junte-as (merge_categories) — e rode o dry-run de novo.',
            }
        }

        const fingerprint = computeMergeFingerprint({
            transactionIds: transactions.map((t) => t.id),
            childIds: plan.childrenToReparent.map((c) => c.id),
        })

        const confirmationToken = randomBytes(24).toString('hex')
        const pending: PendingMerge = { userId, sourceId, targetId, fingerprint, used: false }
        await redis.set(this.redisKey(confirmationToken), JSON.stringify(pending), 'EX', CONFIRMATION_TTL_SECONDS)

        return {
            ...summary,
            canExecute: true,
            confirmationToken,
            expiresInSeconds: CONFIRMATION_TTL_SECONDS,
            message:
                `Nada foi alterado ainda. Para executar, chame de novo com dryRun:false e o mesmo confirmationToken: ` +
                `vai mover ${transactions.length} transação(ões), reapontar ${plan.childrenToReparent.length} subcategoria(s) ` +
                `e APAGAR a categoria "${plan.source.name.trim()}".`,
        }
    }

    async confirm(userId: string, confirmationToken: string, sourceId: string, targetId: string): Promise<MergeCategoriesConfirmResult> {
        const key = this.redisKey(confirmationToken)
        const raw = await redis.get(key)
        if (!raw) {
            throw new Error('CONFIRMATION_EXPIRED: token de confirmação inválido ou expirado — rode um novo dryRun (dryRun: true) antes de confirmar.')
        }

        const pending: PendingMerge = JSON.parse(raw)

        if (pending.userId !== userId) {
            throw new Error('Token de confirmação não pertence a este usuário')
        }

        if (pending.used) {
            return {
                operationId: pending.operationId!,
                movedTransactionCount: 0,
                reparentedSubcategoryCount: 0,
                deletedCategoryId: pending.sourceId,
                alreadyExecuted: true,
            }
        }

        this.assertNotSystem(sourceId, targetId)

        if (pending.sourceId !== sourceId || pending.targetId !== targetId) {
            throw new Error('CONFIRMATION_MISMATCH: as categorias de origem/destino são diferentes das usadas no dry-run — rode um novo dryRun.')
        }

        // Validação e escrita na MESMA transação: o estado que foi validado é
        // exatamente o que vai ser alterado (não há janela entre "olhar" e "gravar").
        const result = await this.unitOfWork.run(async ({ categoryRepository, mcpAuditLogRepository }) => {
            const categories = await categoryRepository.listByUserId(userId)
            const plan = planMerge(categories, sourceId, targetId)

            if (plan.conflicts.length > 0) {
                throw new Error(`MERGE_CONFLICT: ${describeMergeConflicts(plan.conflicts)}. Nada foi alterado — rode um novo dryRun.`)
            }
            this.assertDepthOk(plan)

            const transactions = await categoryRepository.listTransactionRefs(userId, sourceId)
            const transactionIds = transactions.map((t) => t.id)
            const childIds = plan.childrenToReparent.map((c) => c.id)

            if (computeMergeFingerprint({ transactionIds, childIds }) !== pending.fingerprint) {
                throw new Error('CONFIRMATION_MISMATCH: o conjunto afetado mudou desde o dry-run (transação ou subcategoria entrou/saiu) — rode um novo dryRun.')
            }

            // Ordem importa: o FK é ON DELETE SET NULL, então mover/reapontar
            // ANTES de apagar é o que impede orfanar transações e subcategorias.
            const movedTransactions = await categoryRepository.moveTransactionsToCategory(userId, sourceId, targetId)
            if (movedTransactions !== transactionIds.length) {
                throw new Error('CONFIRMATION_MISMATCH: o número de transações movidas difere do dry-run — nada foi alterado, rode um novo dryRun.')
            }

            const reparented = await categoryRepository.reparentCategories(userId, childIds, targetId)
            if (reparented !== childIds.length) {
                throw new Error('CONFIRMATION_MISMATCH: o número de subcategorias reapontadas difere do dry-run — nada foi alterado, rode um novo dryRun.')
            }

            const deleted = await categoryRepository.deleteForUser(userId, sourceId)
            if (!deleted) {
                throw new Error('Categoria de origem não encontrada')
            }

            const previousState: MergePreviousState = {
                category: snapshotCategory(plan.source),
                transactionIds,
                childIds,
            }
            const newState: MergeNewState = { targetId }
            const auditLog = await mcpAuditLogRepository.create({
                userId,
                tool: 'merge_categories',
                params: { sourceId, targetId },
                previousState,
                newState,
            })

            return {
                operationId: auditLog.id,
                movedTransactionCount: movedTransactions,
                reparentedSubcategoryCount: reparented,
            }
        })

        pending.used = true
        pending.operationId = result.operationId
        await redis.set(key, JSON.stringify(pending), 'EX', CONFIRMATION_TTL_SECONDS)

        return { ...result, deletedCategoryId: sourceId, alreadyExecuted: false }
    }

    private redisKey(confirmationToken: string): string {
        return `mcp:merge-categories:${confirmationToken}`
    }

    private assertNotSystem(sourceId: string, targetId: string): void {
        assertNotSystemCategoryId(sourceId, 'mesclada (origem)')
        assertNotSystemCategoryId(targetId, 'usada como destino de merge')
    }

    private assertDepthOk(plan: MergePlan): void {
        if (plan.depthViolations.length > 0) {
            throw new Error(
                `MAX_DEPTH_EXCEEDED: depois do merge a árvore passaria de 3 níveis contando a subárvore reapontada: ${describeDepthViolations(plan.depthViolations)}. ` +
                'Mova essas subcategorias pra outro lugar (move_category) ou escolha outro destino.',
            )
        }
    }
}
