import { Transaction } from "@prisma/client"

export interface TransactionHandler {
    setNext(handler: TransactionHandler): TransactionHandler
    handle(transaction: Partial<Transaction>): Promise<Partial<Transaction>>
}