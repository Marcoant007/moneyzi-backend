import type { Prisma, TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/library'

export interface TransactionRepository {
    create(data: Prisma.TransactionUncheckedCreateInput): Promise<void>
    groupTotalsByType(userId?: string): Promise<Array<{ type: TransactionType; _sum: { amount: Decimal | null } }>>
    aggregateMonthlyAmount(range: { start: Date; end: Date; userId?: string }): Promise<{ _sum: { amount: Decimal | null } }>
}
