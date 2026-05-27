import type { Prisma, PaymentStatus, TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/library'

export interface PayablesFilter {
    month?: number
    year?: number
    status?: PaymentStatus
}

export interface TransactionListItem {
    id: string
    name: string
    description: string | null
    type: TransactionType
    amount: number
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
    date: Date
    dueDate: Date | null
    isRecurring: boolean
    paymentStatus: PaymentStatus
    paidAt: Date | null
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
    userId: string
    categoryId: string | null
    creditCardId: string | null
    accountId: string | null
    categoryRef: { id: string; name: string } | null
    account: { id: string; name: string } | null
}

export interface UpsertTransactionData {
    id?: string
    name: string
    amount: number
    type: TransactionType
    category: TransactionCategory
    categoryId?: string | null
    accountId?: string | null
    creditCardId?: string | null
    paymentMethod: TransactionPaymentMethod
    date: Date
    dueDate?: Date | null
    isRecurring?: boolean
    paymentStatus?: PaymentStatus
    userId: string
}

export interface TransactionRepository {
    create(data: Prisma.TransactionUncheckedCreateInput): Promise<void>
    findMany(userId: string, filters: { month: number; year: number; accountId?: string }): Promise<TransactionListItem[]>
    countCurrentMonth(userId: string): Promise<number>
    upsert(data: UpsertTransactionData): Promise<void>
    hardDelete(id: string, userId: string): Promise<void>
    updateManyCategory(ids: string[], userId: string, data: { category?: TransactionCategory; categoryId?: string | null }): Promise<number>
    updateAmount(id: string, userId: string, amount: number): Promise<void>
    findManyByIds(ids: string[], userId: string): Promise<Array<{ id: string; amount: Decimal; creditCardId: string | null; dueDate: Date | null; category: TransactionCategory; paymentMethod: TransactionPaymentMethod; accountId: string | null }>>
    groupAccountMovements(userId: string, accountId: string): Promise<Array<{ type: TransactionType; _sum: { amount: Decimal | null } }>>
    groupAllAccountsMovements(userId: string): Promise<Array<{ accountId: string | null; type: TransactionType; _sum: { amount: Decimal | null } }>>
    findByCategory(categoryId: string, userId: string, month?: string, year?: string): Promise<Array<{
        id: string
        name: string
        amount: number
        date: Date
        paymentMethod: string
    }>>
    findByEnumCategory(category: string, userId: string, month?: string, year?: string): Promise<Array<{
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
    aggregateRecurringAmount(range: { start: Date; end: Date; userId: string; type: TransactionType; isRecurring?: boolean }): Promise<{ _sum: { amount: Decimal | null } }>
    /**
     * Agrega despesas usando a mesma heurística de fixo/variável do GetMonthlySummaryUseCase:
     * - Fixo: isRecurring=true OU (isRecurring=false, sem categoria customizada, categoria em FIXED_ENUM_CATEGORIES)
     * - Variável: tudo que não é fixo
     */
    aggregateExpensesByType(range: { start: Date; end: Date; userId: string; isFixed: boolean }): Promise<{ _sum: { amount: Decimal | null } }>
    findUpcoming(startDate: Date, endDate: Date): Promise<Array<Prisma.TransactionGetPayload<{}> & { dueDate: Date }>>
    findOverdue(currentDate: Date): Promise<Array<Prisma.TransactionGetPayload<{}> & { dueDate: Date }>>
    findByCreditCardAndPeriod(creditCardId: string, startDate: Date, endDate: Date): Promise<Array<Prisma.TransactionGetPayload<{}>>>
    findByCreditCardId(creditCardId: string, month: number, year: number): Promise<Array<Prisma.TransactionGetPayload<{}>>>
    findDashboardTransactions(
        userId: string,
        range: { start: Date; end: Date }
    ): Promise<Array<Prisma.TransactionGetPayload<{ include: { creditCard: true } }>>>
    // Payables & Receivables
    findPayables(userId: string, filters?: PayablesFilter): Promise<Array<Prisma.TransactionGetPayload<{ include: { creditCard: true } }>>>
    findReceivables(userId: string, filters?: PayablesFilter): Promise<Array<Prisma.TransactionGetPayload<{}>>>
    markAsPaid(ids: string[], paidAt?: Date): Promise<void>
    markAsPending(ids: string[]): Promise<void>
}
