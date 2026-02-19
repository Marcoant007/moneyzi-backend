import { AbstractTransactionHandler } from './abstract-transaction-handler'
import logger from '@/lib/logger'
import type { Prisma } from '@prisma/client'
import { TransactionMessage } from '../types/transaction-message'
import type { UserRepository } from '@/application/repositories/user-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import { ImportJobStatus } from '@prisma/client'

export class PersistTransactionHandler extends AbstractTransactionHandler {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly transactionRepository: TransactionRepository,
        private readonly importJobRepository: ImportJobRepository,
    ) {
        super()
    }

    async handle(transaction: TransactionMessage): Promise<TransactionMessage> {
        logger.debug({
            date: transaction.date,
            amount: transaction.amount,
            userId: transaction.userId,
            name: transaction.name ? String(transaction.name).slice(0, 60) : undefined,
            creditCardId: transaction.creditCardId,
        }, 'Processing transaction')

        if (!transaction.userId || !transaction.name || !transaction.amount || !transaction.date) {
            throw new Error('Transação incompleta')
        }

        transaction.userId = transaction.userId.trim()

        const userExists = await this.userRepository.findById(transaction.userId)
        if (!userExists) {
            logger.warn({ userId: transaction.userId }, 'User for transaction not found')
            throw new Error('User not found')
        }

        if (!transaction.type || !transaction.category || !transaction.paymentMethod) {
            throw new Error('Transação sem classificação completa')
        }

        const persistedAt = transaction.date instanceof Date
            ? transaction.date
            : new Date(transaction.date)

        const payload: Prisma.TransactionUncheckedCreateInput = {
            userId: transaction.userId,
            name: transaction.name,
            amount: transaction.amount,
            date: persistedAt,
            description: transaction.description ?? null,
            type: transaction.type,
            category: transaction.category,
            paymentMethod: transaction.paymentMethod,
            categoryId: transaction.categoryId ?? null,
            importJobId: transaction.importJobId ?? null,
            creditCardId: transaction.creditCardId ?? null,
            isRecurring: transaction.isRecurring ?? false,
        }

        await this.transactionRepository.create(payload)

        if (transaction.creditCardId) {
            logger.info({
                transactionName: transaction.name,
                creditCardId: transaction.creditCardId
            }, 'Transaction linked to credit card')
        }

        const jobId = (transaction as any).importJobId as string | undefined
        if (jobId) {
            try {
                const job = await this.importJobRepository.incrementProcessed(jobId)

                if (job.processed >= job.total) {
                    await this.importJobRepository.markStatus(jobId, ImportJobStatus.COMPLETED)
                }
            } catch (err) {
                logger.warn({ err }, 'Não foi possível atualizar ImportJob')
            }
        }

        return transaction
    }
}
