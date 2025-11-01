import { TransactionHandler } from '../interface/transaction-handler'
import { TransactionMessage } from '../types/transaction-message'

export abstract class AbstractTransactionHandler implements TransactionHandler {
    private nextHandler: TransactionHandler | null = null

    setNext(handler: TransactionHandler): TransactionHandler {
        this.nextHandler = handler
        return handler
    }

    async handle(transaction: TransactionMessage): Promise<TransactionMessage> {
        if (this.nextHandler) {
            return this.nextHandler.handle(transaction)
        }
        return transaction
    }
}