import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Category } from '@prisma/client'

interface CategoryWithTransactionsDto {
    id: string
    name: string
    createdAt: Date
    totalSpend: number
    isVirtual?: boolean
    transactions: {
        id: string
        name: string
        amount: number
        date: Date
        paymentMethod: string
    }[]
}

const ENUM_CATEGORY_LABEL: Record<string, string> = {
    HOUSING: 'Moradia',
    TRANSPORTATION: 'Transporte',
    FOOD: 'Alimentação',
    ENTERTAINMENT: 'Entretenimento',
    HEALTH: 'Saúde',
    UTILITY: 'Utilidades',
    EDUCATION: 'Educação',
    OTHER: 'Outros (sem categoria)',
    SIGNATURE: 'Assinaturas',
    FOOD_DELIVERY: 'Delivery',
    GAMING: 'Jogos',
    SERVICES: 'Serviços',
    STREAMING: 'Streaming',
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

        // Also fetch transactions that have no custom categoryId, grouped by enum category
        const enumResults = await Promise.all(
            Object.keys(ENUM_CATEGORY_LABEL).map(async (enumCat) => {
                const transactions = await this.transactionRepository.findByEnumCategory(
                    enumCat,
                    userId,
                    month,
                    year
                )
                return { enumCat, transactions }
            })
        )

        for (const { enumCat, transactions } of enumResults) {
            if (transactions.length === 0) continue
            const totalSpend = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
            categoriesWithTransactions.push({
                id: `enum:${enumCat}`,
                name: ENUM_CATEGORY_LABEL[enumCat],
                createdAt: new Date(0),
                totalSpend,
                isVirtual: true,
                transactions: transactions.map(t => ({
                    id: t.id,
                    name: t.name,
                    amount: t.amount,
                    date: t.date,
                    paymentMethod: t.paymentMethod,
                })),
            })
        }

        // Sort by totalSpend descending
        categoriesWithTransactions.sort((a, b) => b.totalSpend - a.totalSpend)

        return { categories: categoriesWithTransactions }
    }
}