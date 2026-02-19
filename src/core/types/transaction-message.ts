import { TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'

export interface TransactionMessage {
    userId: string
    name?: string
    amount?: number
    date?: string | Date
    description?: string | null
    type?: TransactionType
    category?: TransactionCategory
    paymentMethod?: TransactionPaymentMethod
    importJobId?: string
    creditCardId?: string
    isRecurring?: boolean
    categoryId?: string
}
