import type { PaymentStatus } from '@prisma/client'
import type { TransactionRepository, PayablesFilter } from '@/application/repositories/transaction-repository'

export type EffectiveStatus = 'PAID' | 'PENDING' | 'OVERDUE'

export interface TransactionItem {
    id: string
    name: string
    description: string | null
    amount: number
    dueDate: Date
    paymentStatus: PaymentStatus
    effectiveStatus: EffectiveStatus
    paidAt: Date | null
    isRecurring: boolean
    category: string
}

export interface CardStatementItem {
    creditCardId: string
    cardName: string
    dueDate: Date
    totalAmount: number
    effectiveStatus: EffectiveStatus
    transactionIds: string[]
    itemCount: number
}

export interface PayablesTotals {
    total: number
    pending: number
    paid: number
    overdue: number
}

export interface GetPayablesReceivablesInput {
    userId: string
    month?: number
    year?: number
    status?: PaymentStatus
}

export interface GetPayablesReceivablesOutput {
    payables: {
        fixed: TransactionItem[]
        variable: TransactionItem[]
        cardStatements: CardStatementItem[]
        totals: PayablesTotals
    }
    receivables: {
        items: TransactionItem[]
        totals: PayablesTotals
    }
    summary: {
        netProjection: number
    }
}

export class GetPayablesReceivablesUseCase {
    constructor(private readonly transactionRepository: TransactionRepository) { }

    async execute(input: GetPayablesReceivablesInput): Promise<GetPayablesReceivablesOutput> {
        const filters: PayablesFilter = {
            month: input.month,
            year: input.year,
            status: input.status,
        }

        const today = this.todayStart()

        const [rawPayables, rawReceivables] = await Promise.all([
            this.transactionRepository.findPayables(input.userId, filters),
            this.transactionRepository.findReceivables(input.userId, filters),
        ])

        // ── Separate card transactions from regular payables ──
        const cardTransactions = rawPayables.filter((transaction) => transaction.creditCardId !== null)
        const plainPayables = rawPayables.filter((transaction) => transaction.creditCardId === null)

        // ── Map plain payables to items ──
        const allPlainItems = plainPayables.map((transaction) =>
            this.toTransactionItem(transaction, today)
        )

        const fixed = allPlainItems.filter((item) => item.isRecurring)
        const variable = allPlainItems.filter((item) => !item.isRecurring)

        // ── Group card transactions into statements ──
        const cardStatements = this.groupCardStatements(cardTransactions, today)
            .filter((statement) => this.isInPeriod(statement.dueDate, input.month, input.year))

        // ── totals for payables (plain + card) ──
        const cardStatementAmounts = cardStatements.map((statement) => ({
            amount: statement.totalAmount,
            effectiveStatus: statement.effectiveStatus,
        }))

        const payablesTotals = this.computeTotals([
            ...allPlainItems,
            ...cardStatementAmounts,
        ])

        // ── Receivables ──
        const receivableItems = rawReceivables.map((transaction) => this.toTransactionItem(transaction, today))
        const receivablesTotals = this.computeTotals(receivableItems)

        const netProjection = receivablesTotals.pending - payablesTotals.pending

        return {
            payables: {
                fixed,
                variable,
                cardStatements,
                totals: payablesTotals,
            },
            receivables: {
                items: receivableItems,
                totals: receivablesTotals,
            },
            summary: {
                netProjection,
            },
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    computeEffectiveStatus(
        paymentStatus: PaymentStatus,
        dueDate: Date,
        today: Date
    ): EffectiveStatus {
        if (paymentStatus === 'PAID') return 'PAID'
        if (dueDate < today) return 'OVERDUE'
        return 'PENDING'
    }

    private toTransactionItem(
        transaction: {
            id: string
            name: string
            description: string | null
            amount: any
            date: Date
            dueDate: Date | null
            paymentStatus: PaymentStatus
            paidAt: Date | null
            isRecurring: boolean
            category: string
        },
        today: Date
    ): TransactionItem {
        // Use dueDate if present, otherwise fall back to the transaction date
        const dueDate = transaction.dueDate ?? transaction.date
        return {
            id: transaction.id,
            name: transaction.name,
            description: transaction.description,
            amount: Number(transaction.amount),
            dueDate,
            paymentStatus: transaction.paymentStatus,
            effectiveStatus: this.computeEffectiveStatus(transaction.paymentStatus, dueDate, today),
            paidAt: transaction.paidAt,
            isRecurring: transaction.isRecurring,
            category: transaction.category,
        }
    }

    groupCardStatements(
        cardTransactions: Array<{
            id: string
            creditCardId: string | null
            date: Date
            dueDate: Date | null
            amount: any
            paymentStatus: PaymentStatus
            creditCard?: { name: string; dueDay?: number | null; closingDay?: number | null } | null
        }>,
        today: Date
    ): CardStatementItem[] {
        const groupsByKey = new Map<string, {
            creditCardId: string
            cardName: string
            dueDate: Date
            totalAmount: number
            transactionIds: string[]
            hasPending: boolean
            hasPaid: boolean
        }>()

        for (const transaction of cardTransactions) {
            if (!transaction.creditCardId) continue

            const dueDate = this.resolveCardDueDate(
                transaction.dueDate,
                transaction.date,
                transaction.creditCard?.dueDay ?? null,
                transaction.creditCard?.closingDay ?? null,
            )
            if (!dueDate) continue

            const groupKey = `${transaction.creditCardId}__${dueDate.getFullYear()}-${dueDate.getMonth()}`

            if (!groupsByKey.has(groupKey)) {
                groupsByKey.set(groupKey, {
                    creditCardId: transaction.creditCardId,
                    cardName: (transaction as any).creditCard?.name ?? 'Cartão',
                    dueDate,
                    totalAmount: 0,
                    transactionIds: [],
                    hasPending: false,
                    hasPaid: false,
                })
            }

            const group = groupsByKey.get(groupKey)!
            group.totalAmount += Number(transaction.amount)
            group.transactionIds.push(transaction.id)

            if (transaction.paymentStatus === 'PAID') {
                group.hasPaid = true
            } else {
                group.hasPending = true
            }
        }

        return Array.from(groupsByKey.values()).map((group) => {
            let effectiveStatus: EffectiveStatus = 'PENDING'

            if (!group.hasPending) {
                effectiveStatus = 'PAID'
            } else if (group.dueDate < today) {
                effectiveStatus = 'OVERDUE'
            }

            return {
                creditCardId: group.creditCardId,
                cardName: group.cardName,
                dueDate: group.dueDate,
                totalAmount: group.totalAmount,
                effectiveStatus,
                transactionIds: group.transactionIds,
                itemCount: group.transactionIds.length,
            }
        })
    }

    private isInPeriod(date: Date, month?: number, year?: number): boolean {
        if (month && year) {
            return date.getFullYear() === year && date.getMonth() === month - 1
        }

        if (year) {
            return date.getFullYear() === year
        }

        return true
    }

    private resolveCardDueDate(
        dueDate: Date | null,
        transactionDate: Date,
        dueDay: number | null,
        closingDay: number | null,
    ): Date | null {
        if (dueDate) return dueDate
        if (!dueDay) return null

        return this.computeCardDueDate(transactionDate, dueDay, closingDay ?? undefined)
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

        const computed = new Date(dueYear, dueMonth, safeDueDay)
        computed.setHours(0, 0, 0, 0)
        return computed
    }

    private computeTotals(items: Array<{ amount: number; effectiveStatus: EffectiveStatus }>): PayablesTotals {
        let total = 0, pending = 0, paid = 0, overdue = 0

        for (const item of items) {
            total += item.amount
            if (item.effectiveStatus === 'PAID') {
                paid += item.amount
            } else if (item.effectiveStatus === 'OVERDUE') {
                overdue += item.amount
                pending += item.amount
            } else {
                pending += item.amount
            }
        }

        return { total, pending, paid, overdue }
    }

    private todayStart(): Date {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return today
    }
}

