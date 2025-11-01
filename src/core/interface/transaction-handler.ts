import { TransactionMessage } from '../types/transaction-message'

export interface TransactionHandler {
    setNext(handler: TransactionHandler): TransactionHandler
    handle(transaction: TransactionMessage): Promise<TransactionMessage>
}