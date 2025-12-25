import { CategoryRepository } from '@/application/repositories/category-repository'
import { Category } from '@prisma/client'

export class ListCategoriesUseCase {
    constructor(private categoryRepository: CategoryRepository) { }

    async execute(userId: string): Promise<Category[]> {
        return this.categoryRepository.listByUserId(userId)
    }
}
