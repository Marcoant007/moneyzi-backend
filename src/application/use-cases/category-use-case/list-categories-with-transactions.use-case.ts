import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Category } from '@prisma/client'

interface CategoryWithTransactionsDto {
    id: string
    name: string
    createdAt: Date
    totalSpend: number
    transactions: {
        id: string
        name: string
        amount: number
        date: Date
        paymentMethod: string
    }[]
}

export class ListCategoriesWithTransactionsUseCase {
    constructor(
        private readonly categoryRepository: CategoryRepository,
        private readonly transactionRepository: TransactionRepository
    ) { }

    async execute(input: {
        userId: string
        month?: string
        year?: string
    }): Promise<{ categories: CategoryWithTransactionsDto[] }> {
        const { userId, month, year } = input

        const categories = await this.categoryRepository.listByUserId(userId)

        const categoriesWithTransactions: CategoryWithTransactionsDto[] = await Promise.all(
            categories.map(async (category: Category) => {
                const transactions = await this.transactionRepository.findByCategory(
                    category.id,
                    userId,
                    month,
                    year
                )

                const totalSpend = transactions.reduce((sum, transaction) => {
                    return sum + Math.abs(transaction.amount)
                }, 0)

                return {
                    id: category.id,
                    name: category.name,
                    createdAt: category.createdAt,
                    totalSpend,
                    transactions: transactions.map(t => ({
                        id: t.id,
                        name: t.name,
                        amount: t.amount,
                        date: t.date,
                        paymentMethod: t.paymentMethod || 'Não informado',
                    }))
                }
            })
        )

        // Sort by totalSpend descending
        categoriesWithTransactions.sort((a: CategoryWithTransactionsDto, b: CategoryWithTransactionsDto) => b.totalSpend - a.totalSpend)

        return { categories: categoriesWithTransactions }
    }
}