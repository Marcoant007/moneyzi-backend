import { AbstractTransactionHandler } from './abstract-transaction-handler'
import { TransactionMessage } from '../types/transaction-message'

export class NormalizeDescriptionHandler extends AbstractTransactionHandler {
    async handle(transaction: TransactionMessage): Promise<TransactionMessage> {
        if (transaction.name) {
            transaction.name = transaction.name.trim().toLowerCase()
        }
        return super.handle(transaction)
    }
}
