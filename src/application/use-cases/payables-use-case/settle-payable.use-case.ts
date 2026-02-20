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

        const transactions = await prisma.transaction.findMany({
            where: {
                creditCardId,
                dueDate: {
                    gte: startOfMonth,
                    lt: startOfNextMonth,
                },
                deletedAt: null,
            },
            select: { id: true },
        })

        return transactions.map((t) => t.id)
    }
}
