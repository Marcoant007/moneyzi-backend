import type { Prisma, TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/library'

export interface TransactionRepository {
    create(data: Prisma.TransactionUncheckedCreateInput): Promise<void>
    groupTotalsByType(userId?: string, range?: { start: Date; end: Date }): Promise<Array<{ type: TransactionType; _sum: { amount: Decimal | null } }>>
    groupExpensesByCategory(userId?: string, range?: { start: Date; end: Date }): Promise<Array<{ category: TransactionCategory; _sum: { amount: Decimal | null } }>>
    groupExpensesByCategoryId(userId: string): Promise<Array<{ categoryId: string | null; _sum: { amount: Decimal | null } }>>
    findLastTransactions(userId?: string, take?: number): Promise<Array<Prisma.TransactionGetPayload<{}>>>
    aggregateMonthlyAmount(range: { start: Date; end: Date; userId?: string }): Promise<{ _sum: { amount: Decimal | null } }>
}
