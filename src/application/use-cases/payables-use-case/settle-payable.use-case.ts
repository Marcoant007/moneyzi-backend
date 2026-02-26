import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { prisma } from '@/lib/prisma'

export type SettleMode = 'PAY' | 'UNPAY'
export type SettleScope = 'TRANSACTION' | 'CARD_STATEMENT'

export interface SettlePayableInput {
    mode: SettleMode
    scope: SettleScope
    transactionId?: string
    card?: {
        creditCardId: string
        dueDate: string // ISO string
    }
}

export class SettlePayableUseCase {
    constructor(private readonly transactionRepository: TransactionRepository) { }

    async execute(input: SettlePayableInput): Promise<{ updatedCount: number }> {
        const ids = await this.resolveIds(input)

        if (ids.length === 0) {
            throw new Error('No transactions found to settle')
        }

        if (input.mode === 'PAY') {
            await this.transactionRepository.markAsPaid(ids)
        } else {
            await this.transactionRepository.markAsPending(ids)
        }

        return { updatedCount: ids.length }
    }

    private async resolveIds(input: SettlePayableInput): Promise<string[]> {
        if (input.scope === 'TRANSACTION') {
            if (!input.transactionId) {
                throw new Error('transactionId is required for TRANSACTION scope')
            }
            return [input.transactionId]
        }

        // CARD_STATEMENT scope: find all transactions for that card in the same dueDate month/year
        if (!input.card) {
            throw new Error('card is required for CARD_STATEMENT scope')
        }

        const { creditCardId, dueDate: dueDateStr } = input.card
        const dueDate = new Date(dueDateStr)
        const startOfMonth = new Date(dueDate.getFullYear(), dueDate.getMonth(), 1)
        const startOfNextMonth = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 1)
        const previousMonthStart = new Date(dueDate.getFullYear(), dueDate.getMonth() - 1, 1)

        const card = await prisma.creditCard.findUnique({
            where: { id: creditCardId },
            select: { dueDay: true, closingDay: true },
        })

        const transactions = await prisma.transaction.findMany({
            where: {
                creditCardId,
                deletedAt: null,
                OR: [
                    {
                        dueDate: {
                            gte: startOfMonth,
                            lt: startOfNextMonth,
                        },
                    },
                    {
                        dueDate: null,
                        date: {
                            gte: previousMonthStart,
                            lt: startOfNextMonth,
                        },
                    },
                ],
            },
            select: { id: true, date: true, dueDate: true },
        })

        return transactions
            .filter((transaction) => {
                if (transaction.dueDate) return true
                if (!card?.dueDay) return false

                const fallbackDueDate = this.computeCardDueDate(
                    transaction.date,
                    card.dueDay,
                    card.closingDay ?? undefined,
                )

                return (
                    fallbackDueDate.getFullYear() === dueDate.getFullYear()
                    && fallbackDueDate.getMonth() === dueDate.getMonth()
                )
            })
            .map((transaction) => transaction.id)
    }

    private computeCardDueDate(transactionDate: Date, dueDay: number, closingDay?: number): Date {
        const year = transactionDate.getFullYear()
        const month = transactionDate.getMonth()
        const txDay = transactionDate.getDate()

        const monthOffset = closingDay
            ? (txDay > closingDay ? 1 : 0)
            : (txDay > dueDay ? 1 : 0)

        const dueYear = year + Math.floor((month + monthOffset) / 12)
        const dueMonth = (month + monthOffset) % 12
        const lastDay = new Date(dueYear, dueMonth + 1, 0).getDate()
        const safeDueDay = Math.max(1, Math.min(dueDay, lastDay))

        const dueDate = new Date(dueYear, dueMonth, safeDueDay)
        dueDate.setHours(0, 0, 0, 0)
        return dueDate
    }
}
