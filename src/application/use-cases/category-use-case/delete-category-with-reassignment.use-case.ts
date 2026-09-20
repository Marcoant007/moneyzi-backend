import type { CategoryUnitOfWork } from '@/application/repositories/category-unit-of-work'
import {
    snapshotCategory,
    type MergeNewState,
    type MergePreviousState,
} from '@/application/use-cases/mcp-write-use-case/category-operation-states'

export interface DeleteCategoryWithReassignmentInput {
    userId: string
    categoryId: string
    reassignToId: string
}

export interface DeleteCategoryWithReassignmentResult {
    /** Id da auditoria — é o que o "Desfazer" do app manda pro rollback. */
    operationId: string
    deletedCategoryId: string
    reassignedToId: string
    /** Todas as transações movidas — inclui as soft-deleted, que o FK (ON DELETE SET NULL) zeraria ao apagar. */
    movedTransactionCount: number
}

/**
 * Apaga uma categoria que TEM transações, movendo todas pra outra categoria do
 * mesmo usuário — mover e apagar numa transação de banco só (o unit-of-work
 * desfaz tudo se qualquer passo falhar).
 *
 * A ordem importa: como o FK é ON DELETE SET NULL, apagar antes de mover
 * orfanaria as transações em silêncio. Por isso leitura, movimentação e
 * exclusão acontecem dentro da mesma transação, e a contagem movida é
 * conferida contra a lida.
 *
 * Regra herdada do delete simples (e da decisão de produto das subcategorias):
 * categoria com subcategorias não pode ser apagada.
 *
 * A auditoria usa o formato de `merge_categories` de propósito: o
 * CategoryStructureRollback já sabe recriar a categoria com o MESMO id e
 * devolver as transações que ainda estiverem no destino, sem sobrescrever
 * mudanças feitas depois.
 */
export class DeleteCategoryWithReassignmentUseCase {
    constructor(private readonly unitOfWork: CategoryUnitOfWork) { }

    async execute({ userId, categoryId, reassignToId }: DeleteCategoryWithReassignmentInput): Promise<DeleteCategoryWithReassignmentResult> {
        if (categoryId === reassignToId) {
            throw new Error('A categoria de destino deve ser diferente da categoria que será excluída')
        }

        return this.unitOfWork.run(async ({ categoryRepository, mcpAuditLogRepository }) => {
            const categories = await categoryRepository.listByUserId(userId)

            const source = categories.find((c) => c.id === categoryId)
            if (!source) {
                throw new Error('Category not found')
            }

            const target = categories.find((c) => c.id === reassignToId)
            if (!target) {
                throw new Error('Categoria de destino não encontrada')
            }

            if (categories.some((c) => c.parentId === source.id)) {
                throw new Error('Category has children')
            }

            const transactions = await categoryRepository.listTransactionRefs(userId, source.id)
            const transactionIds = transactions.map((t) => t.id)

            const moved = await categoryRepository.moveTransactionsToCategory(userId, source.id, target.id)
            if (moved !== transactionIds.length) {
                throw new Error('CONCURRENT_MODIFICATION: as transações da categoria mudaram durante a operação. Nada foi alterado — tente de novo.')
            }

            const deleted = await categoryRepository.deleteForUser(userId, source.id)
            if (!deleted) {
                throw new Error('Category not found')
            }

            const previousState: MergePreviousState = {
                category: snapshotCategory(source),
                transactionIds,
                childIds: [],
            }
            const newState: MergeNewState = { targetId: target.id }
            const auditLog = await mcpAuditLogRepository.create({
                userId,
                tool: 'merge_categories',
                params: { sourceId: source.id, targetId: target.id, origin: 'app-delete' },
                previousState,
                newState,
            })

            return {
                operationId: auditLog.id,
                deletedCategoryId: source.id,
                reassignedToId: target.id,
                movedTransactionCount: moved,
            }
        })
    }
}
