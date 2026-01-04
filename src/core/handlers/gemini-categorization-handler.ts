import { detectTransactionDataWithIA } from '../gemini/detect-transaction-data-with-ia'
import { AbstractTransactionHandler } from './abstract-transaction-handler'
import { TransactionMessage } from '../types/transaction-message'
import { CategoryRepository } from '@/application/repositories/category-repository'

export class GeminiCategorizationHandler extends AbstractTransactionHandler {
    constructor(private readonly categoryRepository: CategoryRepository) {
        super()
    }

    async handle(transaction: TransactionMessage): Promise<TransactionMessage> {
        if (!transaction.name) return super.handle(transaction)

        const result = await detectTransactionDataWithIA(
            transaction.userId,
            transaction.name,
            transaction.category
        )

        transaction.type = result.type
        transaction.category = result.category
        transaction.paymentMethod = result.paymentMethod
        transaction.categoryId = result.categoryId

        if (!transaction.categoryId && result.categoryName && transaction.userId) {
            try {
                const categories = await this.categoryRepository.listByUserId(transaction.userId)
                const existing = categories.find(c => c.name.toLowerCase() === result.categoryName!.toLowerCase())

                if (existing) {
                    transaction.categoryId = existing.id
                } else {
                    console.log(`Creating new category confirmed by IA: ${result.categoryName}`)
                    const newCategory = await this.categoryRepository.create({
                        userId: transaction.userId,
                        name: result.categoryName
                    })
                    transaction.categoryId = newCategory.id
                }

            } catch (err) {
                console.error('Failed to auto-create category:', err)
            }
        }

        return super.handle(transaction)
    }
}
