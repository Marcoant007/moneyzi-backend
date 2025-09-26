import { AbstractTransactionHandler } from './abstract-transaction-handler'
import { prisma } from '@/lib/prisma'
import type { Transaction } from '@prisma/client'

export class PersistTransactionHandler extends AbstractTransactionHandler {
    async handle(transaction: Partial<Transaction>): Promise<Partial<Transaction>> {
        console.log("Transactions: ", transaction)

        if (!transaction.userId || !transaction.name || !transaction.amount) {
            throw new Error('Transação incompleta')
        }

        const saved = await prisma.transaction.create({
            data: transaction as Transaction,
        })

        return saved
    }
}
