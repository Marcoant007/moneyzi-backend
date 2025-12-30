import { CategoryRepository } from '@/application/repositories/category-repository'
import { TransactionRepository } from '@/application/repositories/transaction-repository'
import { Category } from '@prisma/client'

export class ListCategoriesUseCase {
    constructor(
        private categoryRepository: CategoryRepository,
        private transactionRepository: TransactionRepository
    ) { }

    async execute(userId: string): Promise<(Category & { totalSpend: number })[]> {
        const categories = await this.categoryRepository.listByUserId(userId)

        const spendStats = await this.transactionRepository.groupExpensesByCategoryId(userId)

        const spendMap = new Map<string, number>()
        for (const stat of spendStats) {
            if (stat.categoryId && stat._sum.amount) {
                const current = spendMap.get(stat.categoryId) || 0
                spendMap.set(stat.categoryId, current + Number(stat._sum.amount))
            }
        }

        return categories.map(category => ({
            ...category,
            totalSpend: spendMap.get(category.id) || 0
        }))
    }
}
