import { detectTransactionDataWithIA } from '../openia/detect-transaction-data-with-ia'
import { AbstractTransactionHandler } from './abstract-transaction-handler'
import type { Transaction } from '@prisma/client'

export class OpenAICategorizationHandler extends AbstractTransactionHandler {
    async handle(transaction: Partial<Transaction>): Promise<Partial<Transaction>> {
        if (!transaction.name) return super.handle(transaction)

        const result = await detectTransactionDataWithIA(
            transaction.name,
            transaction.category
        )

        transaction.type = result.type
        transaction.category = result.category
        transaction.paymentMethod = result.paymentMethod

        return super.handle(transaction)
    }
}
