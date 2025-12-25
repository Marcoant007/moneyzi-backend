import { CategoryRepository } from '@/application/repositories/category-repository'
import { Category } from '@prisma/client'

interface UpdateCategoryRequest {
    id: string
    userId: string
    name: string
}

export class UpdateCategoryUseCase {
    constructor(private categoryRepository: CategoryRepository) { }

    async execute({ id, userId, name }: UpdateCategoryRequest): Promise<Category> {
        const category = await this.categoryRepository.findById(id)

        if (!category) {
            throw new Error('Category not found')
        }

        if (category.userId !== userId) {
            throw new Error('Unauthorized')
        }

        const nameExists = await this.categoryRepository.existsByName(userId, name)
        if (nameExists && category.name.toLowerCase() !== name.toLowerCase()) {
            throw new Error('Category name already exists')
        }

        return this.categoryRepository.update(id, { name })
    }
}
