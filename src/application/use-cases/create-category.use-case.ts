import { CategoryRepository } from '@/application/repositories/category-repository'
import { Category } from '@prisma/client'

interface CreateCategoryRequest {
    name: string
    userId: string
}

export class CreateCategoryUseCase {
    constructor(private categoryRepository: CategoryRepository) { }

    async execute({ name, userId }: CreateCategoryRequest): Promise<Category> {
        const categoryExists = await this.categoryRepository.existsByName(userId, name)

        if (categoryExists) {
            throw new Error('Category already exists')
        }

        return this.categoryRepository.create({
            name,
            userId
        })
    }
}
