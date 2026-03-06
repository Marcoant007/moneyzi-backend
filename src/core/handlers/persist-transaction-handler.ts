import { AbstractTransactionHandler } from './abstract-transaction-handler'
import logger from '@/lib/logger'
import type { Prisma } from '@prisma/client'
import { TransactionMessage } from '../types/transaction-message'
import type { UserRepository } from '@/application/repositories/user-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CreditCardRepository } from '@/core/repositories/credit-card-repository'

export class PersistTransactionHandler extends AbstractTransactionHandler {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly transactionRepository: TransactionRepository,
        private readonly creditCardRepository: CreditCardRepository,
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
            isCreditCardInvoice: transaction.isCreditCardInvoice,
            statementAnchorDate: transaction.statementAnchorDate,
        }, 'Processing transaction')

        if (
            !transaction.userId ||
            !transaction.name ||
            transaction.amount == null ||
            Number.isNaN(transaction.amount) ||
            !transaction.date
        ) {
            throw new Error('Transacao incompleta')
        }

        transaction.userId = transaction.userId.trim()

        const userExists = await this.userRepository.findById(transaction.userId)
        if (!userExists) {
            logger.warn({ userId: transaction.userId }, 'User for transaction not found')
            throw new Error('User not found')
        }

        if (!transaction.type || !transaction.category || !transaction.paymentMethod) {
            throw new Error('Transacao sem classificacao completa')
        }

        const persistedAt = transaction.date instanceof Date
            ? transaction.date
            : new Date(transaction.date)
        const computedDueDate = await this.resolveDueDate(transaction, persistedAt)

        const payload: Prisma.TransactionUncheckedCreateInput = {
            userId: transaction.userId,
            name: transaction.name,
            amount: transaction.amount,
            date: persistedAt,
            dueDate: computedDueDate ?? null,
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
                creditCardId: transaction.creditCardId,
                dueDate: computedDueDate,
            }, 'Transaction linked to credit card')
        }

        return transaction
    }

    private async resolveDueDate(transaction: TransactionMessage, baseDate: Date): Promise<Date | undefined> {
        if (!transaction.creditCardId) return undefined

        const card = await this.creditCardRepository.findById(transaction.creditCardId)
        if (!card || card.userId !== transaction.userId) return undefined
        if (!card.dueDay) return undefined

        const anchor = this.resolveInvoiceAnchorDate(transaction)
        if (anchor) {
            return this.computeInvoiceDueDate(anchor, card.dueDay)
        }

        return this.computeCardDueDate(baseDate, card.dueDay, card.closingDay ?? undefined)
    }

    private computeInvoiceDueDate(anchorDate: Date, dueDay: number): Date {
        const nextMonth = anchorDate.getMonth() + 1
        const year = anchorDate.getFullYear() + Math.floor(nextMonth / 12)
        const month = nextMonth % 12
        const lastDay = new Date(year, month + 1, 0).getDate()
        const safeDueDay = Math.max(1, Math.min(dueDay, lastDay))
        const due = new Date(year, month, safeDueDay, 12, 0, 0, 0)
        return due
    }

    private resolveInvoiceAnchorDate(transaction: TransactionMessage): Date | undefined {
        if (!transaction.isCreditCardInvoice || !transaction.statementAnchorDate) {
            return undefined
        }

        const anchor = transaction.statementAnchorDate instanceof Date
            ? transaction.statementAnchorDate
            : new Date(transaction.statementAnchorDate)

        if (Number.isNaN(anchor.getTime())) {
            return undefined
        }

        return anchor
    }

    private computeCardDueDate(transactionDate: Date, dueDay: number, closingDay?: number): Date {
        const year = transactionDate.getFullYear()
        const month = transactionDate.getMonth()
        const txDay = transactionDate.getDate()

        // With a closing day the statement cycle is:
        //   txDay <= closingDay → belongs to CURRENT statement → paid NEXT month (+1)
        //   txDay >  closingDay → belongs to NEXT    statement → paid in 2 months  (+2)
        // Without a closing day we use the dueDay itself as the cycle boundary.
        const monthOffset = closingDay
            ? (txDay > closingDay ? 2 : 1)
            : (txDay > dueDay ? 1 : 0)

        const dueYear = year + Math.floor((month + monthOffset) / 12)
        const dueMonth = (month + monthOffset) % 12
        const lastDay = new Date(dueYear, dueMonth + 1, 0).getDate()
        const safeDueDay = Math.max(1, Math.min(dueDay, lastDay))

        // Use noon (12:00) to avoid the date shifting back one day when
        // the value is serialised to UTC and read back in UTC-3 (Brazil).
        return new Date(dueYear, dueMonth, safeDueDay, 12, 0, 0, 0)
    }
}
