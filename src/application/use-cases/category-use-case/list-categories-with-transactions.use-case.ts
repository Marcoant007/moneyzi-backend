import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Category } from '@prisma/client'
import { getCategoryDepth } from '@/utils/category-hierarchy'

interface CategoryWithTransactionsDto {
    id: string
    name: string
    parentId: string | null
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
                    parentId: category.parentId,
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

        this.rollupIntoAncestors(categoriesWithTransactions)

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
                parentId: null,
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

    /**
     * Soma o totalSpend e concatena as transações de cada categoria real na
     * sua cadeia de ancestrais (subcategoria -> categoria -> ...), processando
     * da folha pra raiz — assim uma categoria-mãe sempre reflete "própria +
     * todas as descendentes", tanto no total quanto na lista de transações.
     * Categorias virtuais (enum:*) nunca entram aqui — são adicionadas depois.
     */
    private rollupIntoAncestors(categories: CategoryWithTransactionsDto[]): void {
        const byId = new Map(categories.map(c => [c.id, c]))
        const byDepthDesc = [...categories].sort(
            (a, b) => getCategoryDepth(categories, b.id) - getCategoryDepth(categories, a.id)
        )

        for (const category of byDepthDesc) {
            if (!category.parentId) continue
            const parent = byId.get(category.parentId)
            if (!parent) continue

            parent.totalSpend += category.totalSpend
            parent.transactions = parent.transactions.concat(category.transactions)
        }
    }
}