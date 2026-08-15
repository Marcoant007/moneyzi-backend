import { CategoryRepository } from '@/application/repositories/category-repository'
import { Category } from '@prisma/client'

const MAX_CATEGORY_DEPTH = 3

interface CreateCategoryRequest {
    name: string
    userId: string
    parentId?: string | null
}

export class CreateCategoryUseCase {
    constructor(private categoryRepository: CategoryRepository) { }

    async execute({ name, userId, parentId }: CreateCategoryRequest): Promise<{ id: string; name: string; parentId: string | null; createdAt: Date }> {
        if (parentId) {
            const parent = await this.categoryRepository.findById(parentId)

            if (!parent) {
                throw new Error('Categoria pai não encontrada')
            }

            if (parent.userId !== userId) {
                throw new Error('Categoria pai inválida')
            }

            const parentDepth = await this.getDepth(parent)
            if (parentDepth >= MAX_CATEGORY_DEPTH) {
                throw new Error('Profundidade máxima de categorias excedida (máximo de 3 níveis).')
            }
        }

        const categoryExists = await this.categoryRepository.existsByName(userId, name, parentId ?? null)

        if (categoryExists) {
            throw new Error('Category already exists')
        }

        const category = await this.categoryRepository.create({
            name,
            userId,
            ...(parentId !== undefined ? { parentId } : {}),
        })

        return {
            id: category.id,
            name: category.name,
            parentId: category.parentId,
            createdAt: category.createdAt
        }
    }

    private async getDepth(category: Category): Promise<number> {
        if (!category.parentId) return 1

        const grandparent = await this.categoryRepository.findById(category.parentId)
        if (!grandparent || !grandparent.parentId) return 2

        return 3
    }
}
