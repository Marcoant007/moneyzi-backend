import { CategoryRepository } from '@/application/repositories/category-repository'
import { TransactionRepository } from '@/application/repositories/transaction-repository'
import { Category } from '@prisma/client'
import { rollupCategoryTotals } from '@/utils/category-hierarchy'

export class ListCategoriesUseCase {
    constructor(
        private categoryRepository: CategoryRepository,
        private transactionRepository: TransactionRepository
    ) { }

    async execute(userId: string): Promise<Array<{ id: string; name: string; parentId: string | null; color: string | null; icon: string | null; createdAt: Date; totalSpend: number; transactionCount: number; linkedTransactionCount: number }>> {
        const categories = await this.categoryRepository.listByUserId(userId)

        const [spendStats, transactionCountMap, linkedCountMap] = await Promise.all([
            this.transactionRepository.groupExpensesByCategoryId(userId),
            this.categoryRepository.countTransactionsByCategoryId(userId),
            this.categoryRepository.countLinkedTransactionsByCategoryId(userId),
        ])

        const directSpendMap = new Map<string, number>()
        for (const stat of spendStats) {
            if (stat.categoryId && stat._sum.amount) {
                const current = directSpendMap.get(stat.categoryId) || 0
                directSpendMap.set(stat.categoryId, current + Number(stat._sum.amount))
            }
        }

        const rolledUpSpendMap = rollupCategoryTotals(categories, directSpendMap)

        return categories.map(category => ({
            id: category.id,
            name: category.name,
            parentId: category.parentId,
            color: category.color ?? null,
            icon: category.icon ?? null,
            createdAt: category.createdAt,
            totalSpend: rolledUpSpendMap.get(category.id) || 0,
            transactionCount: transactionCountMap.get(category.id) || 0,
            // Inclui as soft-deleted: é o que a trava de exclusão enxerga.
            linkedTransactionCount: linkedCountMap.get(category.id) || 0,
        }))
    }
}
