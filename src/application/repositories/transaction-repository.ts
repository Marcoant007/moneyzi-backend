import type { Prisma, TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/library'

export interface TransactionRepository {
    create(data: Prisma.TransactionUncheckedCreateInput): Promise<void>
    findByCategory(categoryId: string, userId: string, month?: string, year?: string): Promise<Array<{
        id: string
        name: string
        amount: number
        date: Date
        paymentMethod: string
    }>>
    groupTotalsByType(userId?: string, range?: { start: Date; end: Date }): Promise<Array<{ type: TransactionType; _sum: { amount: Decimal | null } }>>
    groupExpensesByCategory(userId?: string, range?: { start: Date; end: Date }): Promise<Array<{ category: TransactionCategory; categoryId: string | null; _sum: { amount: Decimal | null } }>>
    groupExpensesByCategoryId(userId: string, range?: { start: Date; end: Date }): Promise<Array<{ categoryId: string | null; category: TransactionCategory; _sum: { amount: Decimal | null } }>>
    groupExpensesByRecurrence(userId: string, range?: { start: Date; end: Date }): Promise<Array<{ isRecurring: boolean; _sum: { amount: Decimal | null } }>>
    findLastTransactions(userId?: string, take?: number): Promise<Array<Prisma.TransactionGetPayload<{}>>>
    aggregateMonthlyAmount(range: { start: Date; end: Date; userId?: string }): Promise<{ _sum: { amount: Decimal | null } }>
    aggregateRecurringAmount(range: { start: Date; end: Date; userId: string; type: TransactionType }): Promise<{ _sum: { amount: Decimal | null } }>
    findUpcoming(startDate: Date, endDate: Date): Promise<Array<Prisma.TransactionGetPayload<{}> & { dueDate: Date }>>
    findOverdue(currentDate: Date): Promise<Array<Prisma.TransactionGetPayload<{}> & { dueDate: Date }>>
    findByCreditCardAndPeriod(creditCardId: string, startDate: Date, endDate: Date): Promise<Array<Prisma.TransactionGetPayload<{}>>>
    findByCreditCardId(creditCardId: string, month: number, year: number): Promise<Array<Prisma.TransactionGetPayload<{}>>>
}
