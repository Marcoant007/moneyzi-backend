import { AbstractTransactionHandler } from './abstract-transaction-handler'
import { prisma } from '@/lib/prisma'
import type { Transaction } from '@prisma/client'

export class PersistTransactionHandler extends AbstractTransactionHandler {
    async handle(transaction: Partial<Transaction>): Promise<Partial<Transaction>> {
        console.log("Transactions: ", transaction)

        if (!transaction.userId || !transaction.name || !transaction.amount) {
            throw new Error('Transação incompleta')
        }

        const data = { ...transaction } as any

        const saved = await prisma.transaction.create({
            data: data as Transaction,
        })

        const jobId = (transaction as any).importJobId as string | undefined
        if (jobId) {
            try {
                const job = await prisma.importJob.update({
                    where: { id: jobId },
                    data: { processed: { increment: 1 } },
                })

                if (job.processed >= job.total) {
                    await prisma.importJob.update({
                        where: { id: jobId },
                        data: { status: 'COMPLETED' },
                    })
                }
            } catch (err) {
                console.warn('Não foi possível atualizar ImportJob:', err)
            }
        }

        return saved
    }
}
