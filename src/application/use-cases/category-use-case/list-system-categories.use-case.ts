import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { SYSTEM_CATEGORIES, toSystemCategoryId } from '@/utils/system-category'

export interface SystemCategoryListItem {
    /** Id sintético e estável: `system:<ENUM>`. */
    id: string
    /** O próprio enum (ex.: "SERVICES") — é o mesmo nome que list_transactions mostra na transação. */
    name: string
    parentId: null
    transactionCount: number
    isSystem: true
}

/**
 * As categorias de sistema (enum TransactionCategory) não têm linha em Category,
 * então nunca entram no ListCategoriesUseCase (que alimenta o app). Este caso de
 * uso existe só pro MCP, que precisa enxergá-las com um id estável pra filtrar
 * transações por elas. Devolve sempre todas — mesmo as sem transação — pra a
 * lista ser previsível.
 */
export class ListSystemCategoriesUseCase {
    constructor(private readonly transactionRepository: TransactionRepository) { }

    async execute(userId: string): Promise<SystemCategoryListItem[]> {
        const counts = await this.transactionRepository.countBySystemCategory(userId)

        return SYSTEM_CATEGORIES.map((category) => ({
            id: toSystemCategoryId(category),
            name: category,
            parentId: null,
            transactionCount: counts.get(category) ?? 0,
            isSystem: true as const,
        }))
    }
}
