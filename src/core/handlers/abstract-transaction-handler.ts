import type { Transaction } from '@prisma/client'
import { TransactionHandler } from '../interface/transaction-handler'

export abstract class AbstractTransactionHandler implements TransactionHandler {
    private nextHandler: TransactionHandler | null = null

    setNext(handler: TransactionHandler): TransactionHandler {
        this.nextHandler = handler
        return handler
    }

    async handle(transaction: Partial<Transaction>): Promise<Partial<Transaction>> {
        if (this.nextHandler) {
            return this.nextHandler.handle(transaction)
        }
        return transaction
    }
}