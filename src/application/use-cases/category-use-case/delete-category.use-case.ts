import { CategoryRepository } from '@/application/repositories/category-repository'

interface DeleteCategoryRequest {
    id: string
    userId: string
}

export class DeleteCategoryUseCase {
    constructor(private categoryRepository: CategoryRepository) { }

    async execute({ id, userId }: DeleteCategoryRequest): Promise<void> {
        const category = await this.categoryRepository.findById(id)

        if (!category) {
            throw new Error('Category not found')
        }

        if (category.userId !== userId) {
            throw new Error('Unauthorized')
        }

        const hasTransactions = await this.categoryRepository.hasTransactions(id)
        if (hasTransactions) {
            throw new Error('Category has transactions')
        }

        await this.categoryRepository.delete(id)
    }
}
