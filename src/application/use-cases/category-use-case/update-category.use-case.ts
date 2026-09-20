import { CategoryRepository } from '@/application/repositories/category-repository'

const MAX_CATEGORY_DEPTH = 3

interface UpdateCategoryRequest {
    id: string
    userId: string
    name: string
    parentId?: string | null
    /** undefined = não mexe; null = limpa. */
    color?: string | null
    icon?: string | null
}

export class UpdateCategoryUseCase {
    constructor(private categoryRepository: CategoryRepository) { }

    async execute({ id, userId, name, parentId, color, icon }: UpdateCategoryRequest): Promise<{ id: string; name: string; parentId: string | null; color: string | null; icon: string | null; createdAt: Date }> {
        const category = await this.categoryRepository.findById(id)

        if (!category) {
            throw new Error('Category not found')
        }

        if (category.userId !== userId) {
            throw new Error('Unauthorized')
        }

        const isReparenting = parentId !== undefined && parentId !== category.parentId
        let newParentDepth = 0

        if (isReparenting) {
            newParentDepth = await this.validateReparent(id, userId, parentId)
        }

        const effectiveParentId = parentId !== undefined ? parentId : category.parentId
        const nameExists = await this.categoryRepository.existsByName(userId, name, effectiveParentId)
        if (nameExists && category.name.toLowerCase() !== name.toLowerCase()) {
            throw new Error('Category name already exists')
        }

        if (isReparenting) {
            await this.validateSubtreeHeight(id, newParentDepth)
        }

        const updated = await this.categoryRepository.update(id, {
            name,
            ...(isReparenting ? { parentId } : {}),
            ...(color !== undefined ? { color } : {}),
            ...(icon !== undefined ? { icon } : {}),
        })

        return {
            id: updated.id,
            name: updated.name,
            parentId: updated.parentId,
            color: updated.color ?? null,
            icon: updated.icon ?? null,
            createdAt: updated.createdAt
        }
    }

    /**
     * Valida o novo parentId (existência, dono, ciclo, profundidade) e retorna
     * a profundidade que o NOVO pai ocupa (1, 2 ou 3) — ou 0 se for mover pra topo.
     */
    private async validateReparent(id: string, userId: string, parentId: string | null | undefined): Promise<number> {
        if (parentId == null) return 0

        if (parentId === id) {
            throw new Error('Uma categoria não pode ser sua própria categoria pai.')
        }

        let newParentDepth = 1
        let current = await this.categoryRepository.findById(parentId)

        if (!current) {
            throw new Error('Categoria pai não encontrada')
        }
        if (current.userId !== userId) {
            throw new Error('Categoria pai inválida')
        }

        // Anda até 2 níveis acima do novo pai (limite dado pela profundidade
        // máxima de 3) checando se algum ancestral é a própria categoria sendo
        // movida — se for, criaria um ciclo.
        let ancestor = current
        for (let hops = 0; hops < MAX_CATEGORY_DEPTH; hops++) {
            if (ancestor.id === id) {
                throw new Error('Não é possível mover uma categoria para dentro de sua própria subcategoria.')
            }
            if (!ancestor.parentId) break
            newParentDepth++
            ancestor = (await this.categoryRepository.findById(ancestor.parentId))!
        }

        if (newParentDepth >= MAX_CATEGORY_DEPTH) {
            throw new Error('Profundidade máxima de categorias excedida (máximo de 3 níveis).')
        }

        return newParentDepth
    }

    /** Garante que mover a categoria não empurre suas próprias subcategorias além do nível 3. */
    private async validateSubtreeHeight(id: string, newParentDepth: number): Promise<void> {
        const newDepth = newParentDepth + 1
        const hasChildren = await this.categoryRepository.hasChildren(id)
        if (!hasChildren) return

        const hasGrandchildren = await this.categoryRepository.hasGrandchildren(id)
        const subtreeHeight = hasGrandchildren ? 2 : 1

        if (newDepth + subtreeHeight > MAX_CATEGORY_DEPTH) {
            throw new Error('Não é possível mover uma categoria com subcategorias para este nível: excederia a profundidade máxima de 3 níveis.')
        }
    }
}
