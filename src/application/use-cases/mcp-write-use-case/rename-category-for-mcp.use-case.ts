import type { CategoryUnitOfWork } from '@/application/repositories/category-unit-of-work'
import { findSiblingNameCollision } from '@/utils/category-structure'
import { assertNotSystemCategoryId } from '@/utils/system-category'
import type { RenameState } from './category-operation-states'

const MAX_NAME_LENGTH = 100

export interface RenameCategoryForMcpInput {
    userId: string
    categoryId: string
    newName: string
}

export interface RenameCategoryForMcpResult {
    id: string
    name: string
    previousName: string
    parentId: string | null
    /** false quando o nome (já com trim) é exatamente o atual — nada foi gravado. */
    changed: boolean
    operationId: string | null
}

/**
 * Trim no nome (existem categorias legadas com espaço no final) e rejeita
 * colisão case-insensitive com uma irmã do mesmo pai. Renomear só a caixa ou
 * só remover o espaço do final da própria categoria é permitido — a colisão
 * ignora ela mesma.
 */
export class RenameCategoryForMcpUseCase {
    constructor(private readonly unitOfWork: CategoryUnitOfWork) { }

    async execute(input: RenameCategoryForMcpInput): Promise<RenameCategoryForMcpResult> {
        assertNotSystemCategoryId(input.categoryId, 'renomeada')

        const name = input.newName.trim()
        if (!name) {
            throw new Error('INVALID_NAME: o novo nome não pode ser vazio.')
        }
        if (name.length > MAX_NAME_LENGTH) {
            throw new Error(`INVALID_NAME: o nome pode ter no máximo ${MAX_NAME_LENGTH} caracteres.`)
        }

        return this.unitOfWork.run(async ({ categoryRepository, mcpAuditLogRepository }) => {
            // listByUserId já escopa por usuário: id de outro usuário simplesmente não aparece.
            const categories = await categoryRepository.listByUserId(input.userId)
            const category = categories.find((c) => c.id === input.categoryId)
            if (!category) {
                throw new Error('Categoria não encontrada')
            }

            if (category.name === name) {
                return {
                    id: category.id,
                    name: category.name,
                    previousName: category.name,
                    parentId: category.parentId,
                    changed: false,
                    operationId: null,
                }
            }

            const collision = findSiblingNameCollision(categories, category.parentId, name, [category.id])
            if (collision) {
                throw new Error(
                    `NAME_COLLISION: já existe a categoria "${collision.name.trim()}" (${collision.id}) sob o mesmo pai. Escolha outro nome ou junte as duas com merge_categories.`,
                )
            }

            const updated = await categoryRepository.update(category.id, { name })

            const previousState: RenameState = { id: category.id, name: category.name }
            const newState: RenameState = { id: updated.id, name: updated.name }
            const auditLog = await mcpAuditLogRepository.create({
                userId: input.userId,
                tool: 'rename_category',
                params: { categoryId: input.categoryId, newName: input.newName },
                previousState,
                newState,
            })

            return {
                id: updated.id,
                name: updated.name,
                previousName: category.name,
                parentId: updated.parentId,
                changed: true,
                operationId: auditLog.id,
            }
        })
    }
}
