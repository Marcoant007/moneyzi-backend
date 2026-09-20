import type { Category } from '@prisma/client'
import type { CategoryUnitOfWork, CategoryUnitOfWorkContext } from '@/application/repositories/category-unit-of-work'
import type { McpAuditLogEntry } from '@/application/repositories/mcp-audit-log-repository'
import { getCategoryDepth } from '@/utils/category-hierarchy'
import {
    MAX_CATEGORY_DEPTH,
    findSiblingNameCollision,
    getSubtreeHeight,
    planMove,
} from '@/utils/category-structure'
import type { RollbackResult } from './rollback-operation.use-case'
import type {
    CategorySnapshot,
    DeletePreviousState,
    MergeNewState,
    MergePreviousState,
    MoveState,
    RenameState,
} from './category-operation-states'

interface Outcome {
    skipped: Array<{ transactionId: string; reason: string }>
    skippedCategories: Array<{ categoryId: string; reason: string }>
    restoredCategoryId?: string
    restoredTransactionCount?: number
    restoredSubcategoryCount?: number
}

const EMPTY_OUTCOME: Outcome = { skipped: [], skippedCategories: [] }

/**
 * Reverte merge_categories, delete_category, rename_category e move_category.
 * Roda numa única transação (leitura, restauração e marcação de rolledBackAt
 * juntas) — se qualquer passo falhar, nada é restaurado pela metade.
 *
 * Regras comuns:
 * - Recriar categoria preserva o MESMO id e o createdAt originais.
 * - Nunca sobrescreve uma mudança posterior: transação/subcategoria alterada
 *   depois da operação é pulada e reportada, não revertida.
 * - Se o estado atual impede a restauração da própria categoria (pai original
 *   sumiu, nome já ocupado, profundidade), falha com ROLLBACK_BLOCKED e um
 *   motivo — em vez de "consertar" sozinho e mudar algo que ninguém pediu.
 */
export class CategoryStructureRollback {
    constructor(private readonly unitOfWork: CategoryUnitOfWork) { }

    async execute(userId: string, operationId: string): Promise<RollbackResult> {
        return this.unitOfWork.run(async (context) => {
            // Relê a auditoria DENTRO da transação: duas reversões concorrentes
            // da mesma operação não passam as duas pelo "ainda não foi revertida".
            const log = await context.mcpAuditLogRepository.findByIdForUser(operationId, userId)
            if (!log) {
                throw new Error('Operação não encontrada')
            }
            if (log.rolledBackAt) {
                throw new Error('Operação já foi revertida')
            }

            const outcome = await this.revert(context, userId, log)
            await context.mcpAuditLogRepository.markRolledBack(log.id)

            return {
                operationId,
                tool: log.tool,
                rolledBack: true,
                skipped: outcome.skipped,
                skippedCategories: outcome.skippedCategories,
                ...(outcome.restoredCategoryId ? { restoredCategoryId: outcome.restoredCategoryId } : {}),
                ...(outcome.restoredTransactionCount !== undefined ? { restoredTransactionCount: outcome.restoredTransactionCount } : {}),
                ...(outcome.restoredSubcategoryCount !== undefined ? { restoredSubcategoryCount: outcome.restoredSubcategoryCount } : {}),
            }
        })
    }

    private revert(context: CategoryUnitOfWorkContext, userId: string, log: McpAuditLogEntry): Promise<Outcome> {
        switch (log.tool) {
            case 'merge_categories':
                return this.revertMerge(context, userId, log)
            case 'delete_category':
                return this.revertDelete(context, userId, log)
            case 'rename_category':
                return this.revertRename(context, userId, log)
            case 'move_category':
                return this.revertMove(context, userId, log)
            default:
                throw new Error(`Rollback não suportado para a ferramenta "${log.tool}"`)
        }
    }

    private async revertMerge(context: CategoryUnitOfWorkContext, userId: string, log: McpAuditLogEntry): Promise<Outcome> {
        const { categoryRepository } = context
        const previous = log.previousState as MergePreviousState
        const { targetId } = log.newState as MergeNewState

        const categories = await categoryRepository.listByUserId(userId)
        const sourceDepth = this.assertCanRestore(categories, previous.category)

        // Subcategorias: só volta pra origem a que AINDA está sob o destino, ainda
        // cabe na profundidade e não colide de nome com outra que também volta.
        const byId = new Map(categories.map((c) => [c.id, c]))
        const skippedCategories: Outcome['skippedCategories'] = []
        const childrenToRestore: string[] = []
        const namesTaken = new Set<string>()

        for (const childId of previous.childIds) {
            const child = byId.get(childId)
            if (!child) {
                skippedCategories.push({ categoryId: childId, reason: 'Subcategoria não existe mais' })
            } else if (child.parentId !== targetId) {
                skippedCategories.push({ categoryId: childId, reason: 'Subcategoria foi movida ou reapontada de novo depois do merge' })
            } else if (sourceDepth + getSubtreeHeight(categories, childId) > MAX_CATEGORY_DEPTH) {
                skippedCategories.push({ categoryId: childId, reason: `Restaurar excederia a profundidade máxima de ${MAX_CATEGORY_DEPTH} níveis` })
            } else if (namesTaken.has(child.name.trim().toLowerCase())) {
                skippedCategories.push({ categoryId: childId, reason: 'Já existe outra subcategoria restaurada com o mesmo nome' })
            } else {
                namesTaken.add(child.name.trim().toLowerCase())
                childrenToRestore.push(childId)
            }
        }

        // Transações: só volta a que AINDA está no destino (a que foi mexida
        // depois — por uma pessoa ou por outra chamada — fica onde está).
        const current = await categoryRepository.findTransactionCategoryIds(userId, previous.transactionIds)
        const currentById = new Map(current.map((t) => [t.id, t.categoryId]))
        const skipped: Outcome['skipped'] = []
        const transactionsToRestore: string[] = []

        for (const transactionId of previous.transactionIds) {
            if (!currentById.has(transactionId)) {
                skipped.push({ transactionId, reason: 'Transação não encontrada' })
            } else if (currentById.get(transactionId) !== targetId) {
                skipped.push({ transactionId, reason: 'Categoria foi alterada manualmente depois da operação original' })
            } else {
                transactionsToRestore.push(transactionId)
            }
        }

        await this.recreate(categoryRepository, userId, previous.category)

        if (childrenToRestore.length > 0) {
            await categoryRepository.reparentCategories(userId, childrenToRestore, previous.category.id)
        }
        if (transactionsToRestore.length > 0) {
            await categoryRepository.assignTransactionsToCategory(userId, transactionsToRestore, previous.category.id)
        }

        return {
            skipped,
            skippedCategories,
            restoredCategoryId: previous.category.id,
            restoredTransactionCount: transactionsToRestore.length,
            restoredSubcategoryCount: childrenToRestore.length,
        }
    }

    private async revertDelete(context: CategoryUnitOfWorkContext, userId: string, log: McpAuditLogEntry): Promise<Outcome> {
        const { categoryRepository } = context
        const previous = log.previousState as DeletePreviousState

        const categories = await categoryRepository.listByUserId(userId)
        this.assertCanRestore(categories, previous.category)
        await this.recreate(categoryRepository, userId, previous.category)

        return { ...EMPTY_OUTCOME, restoredCategoryId: previous.category.id }
    }

    private async revertRename(context: CategoryUnitOfWorkContext, userId: string, log: McpAuditLogEntry): Promise<Outcome> {
        const { categoryRepository } = context
        const previous = log.previousState as RenameState
        const next = log.newState as RenameState

        const categories = await categoryRepository.listByUserId(userId)
        const category = categories.find((c) => c.id === previous.id)
        if (!category) {
            throw new Error('ROLLBACK_BLOCKED: a categoria renomeada não existe mais.')
        }
        if (category.name !== next.name) {
            throw new Error(`ROLLBACK_BLOCKED: a categoria foi renomeada de novo depois ("${category.name.trim()}"); não vou sobrescrever a mudança mais recente.`)
        }

        const collision = findSiblingNameCollision(categories, category.parentId, previous.name, [category.id])
        if (collision) {
            throw new Error(`ROLLBACK_BLOCKED: o nome original "${previous.name.trim()}" agora pertence a outra categoria (${collision.id}) sob o mesmo pai.`)
        }

        await categoryRepository.update(category.id, { name: previous.name })
        return { ...EMPTY_OUTCOME }
    }

    private async revertMove(context: CategoryUnitOfWorkContext, userId: string, log: McpAuditLogEntry): Promise<Outcome> {
        const { categoryRepository } = context
        const previous = log.previousState as MoveState
        const next = log.newState as MoveState

        const categories = await categoryRepository.listByUserId(userId)
        const category = categories.find((c) => c.id === previous.id)
        if (!category) {
            throw new Error('ROLLBACK_BLOCKED: a categoria movida não existe mais.')
        }
        if ((category.parentId ?? null) !== (next.parentId ?? null)) {
            throw new Error('ROLLBACK_BLOCKED: a categoria foi movida de novo depois; não vou sobrescrever a mudança mais recente.')
        }

        // O estado de hoje pode não comportar mais o pai antigo (ele sumiu, ou
        // reverter criaria ciclo/estouro de profundidade/colisão de nome) —
        // as mesmas regras de move_category valem pra desfazer.
        try {
            planMove(categories, previous.id, previous.parentId)
        } catch (error) {
            throw new Error(`ROLLBACK_BLOCKED: ${error instanceof Error ? error.message : String(error)}`)
        }

        await categoryRepository.update(category.id, { parentId: previous.parentId })
        return { ...EMPTY_OUTCOME }
    }

    /**
     * Confere que a categoria apagada pode voltar exatamente como era e devolve
     * a profundidade em que ela vai ficar.
     */
    private assertCanRestore(categories: Category[], snapshot: CategorySnapshot): number {
        if (categories.some((c) => c.id === snapshot.id)) {
            throw new Error(`ROLLBACK_BLOCKED: já existe uma categoria com o id ${snapshot.id}.`)
        }

        let depth = 1
        if (snapshot.parentId) {
            if (!categories.some((c) => c.id === snapshot.parentId)) {
                throw new Error(`ROLLBACK_BLOCKED: a categoria pai original (${snapshot.parentId}) não existe mais. Recrie ou restaure o pai antes de reverter.`)
            }

            depth = getCategoryDepth(categories, snapshot.parentId) + 1
            if (depth > MAX_CATEGORY_DEPTH) {
                throw new Error(`ROLLBACK_BLOCKED: o pai original foi movido para um nível em que a categoria restaurada passaria de ${MAX_CATEGORY_DEPTH} níveis.`)
            }
        }

        const collision = findSiblingNameCollision(categories, snapshot.parentId, snapshot.name)
        if (collision) {
            throw new Error(`ROLLBACK_BLOCKED: já existe a categoria "${collision.name.trim()}" (${collision.id}) sob o mesmo pai — o nome original está ocupado. Renomeie-a (rename_category) e tente de novo.`)
        }

        return depth
    }

    private recreate(categoryRepository: CategoryUnitOfWorkContext['categoryRepository'], userId: string, snapshot: CategorySnapshot) {
        return categoryRepository.restore({
            id: snapshot.id,
            userId,
            name: snapshot.name,
            parentId: snapshot.parentId,
            createdAt: new Date(snapshot.createdAt),
        })
    }
}
