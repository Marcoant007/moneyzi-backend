import type { Transaction } from '@prisma/client'
import { AbstractTransactionHandler } from './abstract-transaction-handler'

export class NormalizeDescriptionHandler extends AbstractTransactionHandler {
    async handle(transaction: Partial<Transaction>): Promise<Partial<Transaction>> {
        if (transaction.name) {
            transaction.name = transaction.name.trim().toLowerCase()
        }
        return super.handle(transaction)
    }
}
