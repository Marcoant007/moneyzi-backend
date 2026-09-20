import type { CategoryUnitOfWork } from '@/application/repositories/category-unit-of-work'
import { planMove } from '@/utils/category-structure'
import { assertNotSystemCategoryId } from '@/utils/system-category'
import type { MoveState } from './category-operation-states'

export interface MoveCategoryForMcpInput {
    userId: string
    categoryId: string
    /** null transforma a categoria em raiz. */
    newParentId: string | null
}

export interface MoveCategoryForMcpResult {
    id: string
    name: string
    previousParentId: string | null
    newParentId: string | null
    /** false quando a categoria já estava sob esse pai — nada foi gravado. */
    changed: boolean
    operationId: string | null
}

/**
 * Reparenta a categoria (com toda a subárvore). Valida ciclo, profundidade
 * máxima de 3 níveis contando os descendentes, e colisão de nome sob o novo pai
 * — as regras vivem em planMove, que o rollback de move_category também usa.
 */
export class MoveCategoryForMcpUseCase {
    constructor(private readonly unitOfWork: CategoryUnitOfWork) { }

    async execute(input: MoveCategoryForMcpInput): Promise<MoveCategoryForMcpResult> {
        assertNotSystemCategoryId(input.categoryId, 'movida')
        if (input.newParentId) {
            assertNotSystemCategoryId(input.newParentId, 'usada como categoria pai')
        }

        return this.unitOfWork.run(async ({ categoryRepository, mcpAuditLogRepository }) => {
            const categories = await categoryRepository.listByUserId(input.userId)
            const plan = planMove(categories, input.categoryId, input.newParentId)

            const previousParentId = plan.category.parentId ?? null

            if (plan.isNoop) {
                return {
                    id: plan.category.id,
                    name: plan.category.name,
                    previousParentId,
                    newParentId: previousParentId,
                    changed: false,
                    operationId: null,
                }
            }

            await categoryRepository.update(plan.category.id, { parentId: input.newParentId })

            const previousState: MoveState = { id: plan.category.id, parentId: previousParentId }
            const newState: MoveState = { id: plan.category.id, parentId: input.newParentId }
            const auditLog = await mcpAuditLogRepository.create({
                userId: input.userId,
                tool: 'move_category',
                params: { categoryId: input.categoryId, newParentId: input.newParentId },
                previousState,
                newState,
            })

            return {
                id: plan.category.id,
                name: plan.category.name,
                previousParentId,
                newParentId: input.newParentId,
                changed: true,
                operationId: auditLog.id,
            }
        })
    }
}
