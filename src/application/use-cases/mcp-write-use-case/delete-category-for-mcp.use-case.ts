import type { CategoryUnitOfWork } from '@/application/repositories/category-unit-of-work'
import { assertNotSystemCategoryId } from '@/utils/system-category'
import { snapshotCategory, type DeleteNewState, type DeletePreviousState } from './category-operation-states'

const MAX_CHILD_NAMES_IN_MESSAGE = 5

export interface DeleteCategoryForMcpInput {
    userId: string
    categoryId: string
}

export interface DeleteCategoryForMcpResult {
    deletedCategoryId: string
    name: string
    operationId: string
}

/**
 * Só apaga categoria vazia: sem subcategorias e sem NENHUMA transação
 * (soft-deleted inclusive). O FK das duas relações é ON DELETE SET NULL, então
 * um delete "solto" nunca falharia — apagaria e orfanaria tudo em silêncio.
 * Por isso a checagem é explícita, dentro da mesma transação do delete.
 */
export class DeleteCategoryForMcpUseCase {
    constructor(private readonly unitOfWork: CategoryUnitOfWork) { }

    async execute(input: DeleteCategoryForMcpInput): Promise<DeleteCategoryForMcpResult> {
        assertNotSystemCategoryId(input.categoryId, 'apagada')

        return this.unitOfWork.run(async ({ categoryRepository, mcpAuditLogRepository }) => {
            const categories = await categoryRepository.listByUserId(input.userId)
            const category = categories.find((c) => c.id === input.categoryId)
            if (!category) {
                throw new Error('Categoria não encontrada')
            }

            const children = categories.filter((c) => c.parentId === category.id)
            const transactions = await categoryRepository.listTransactionRefs(input.userId, category.id)

            if (children.length > 0 || transactions.length > 0) {
                throw new Error(this.buildInUseMessage(category.name, children.map((c) => c.name), transactions))
            }

            const deleted = await categoryRepository.deleteForUser(input.userId, category.id)
            if (!deleted) {
                throw new Error('Categoria não encontrada')
            }

            const previousState: DeletePreviousState = { category: snapshotCategory(category) }
            const newState: DeleteNewState = { deleted: true }
            const auditLog = await mcpAuditLogRepository.create({
                userId: input.userId,
                tool: 'delete_category',
                params: { categoryId: input.categoryId },
                previousState,
                newState,
            })

            return {
                deletedCategoryId: category.id,
                name: category.name,
                operationId: auditLog.id,
            }
        })
    }

    private buildInUseMessage(
        categoryName: string,
        childNames: string[],
        transactions: Array<{ id: string; deleted: boolean }>,
    ): string {
        const reasons: string[] = []

        if (transactions.length > 0) {
            const trashed = transactions.filter((t) => t.deleted).length
            const trashedNote = trashed > 0
                ? ` (${trashed} já excluída(s) — essas só o merge_categories consegue mover)`
                : ''
            reasons.push(`${transactions.length} transação(ões)${trashedNote}`)
        }

        if (childNames.length > 0) {
            const shown = childNames.slice(0, MAX_CHILD_NAMES_IN_MESSAGE).map((n) => `"${n.trim()}"`).join(', ')
            const extra = childNames.length > MAX_CHILD_NAMES_IN_MESSAGE
                ? ` e mais ${childNames.length - MAX_CHILD_NAMES_IN_MESSAGE}`
                : ''
            reasons.push(`${childNames.length} subcategoria(s) (${shown}${extra})`)
        }

        return (
            `CATEGORY_IN_USE: a categoria "${categoryName.trim()}" não pode ser apagada porque ainda tem ${reasons.join(' e ')}. ` +
            'Esvazie antes: mova as transações (move_transaction_category ou bulk_move_transactions) e as subcategorias (move_category), ' +
            'ou junte tudo em outra categoria com merge_categories.'
        )
    }
}
