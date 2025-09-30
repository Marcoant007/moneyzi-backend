import { TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'

export interface TransactionDto {
    id: string
    name: string
    description?: string | null
    type: TransactionType
    amount: string
    importJobId?: string | null
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
    date: Date
    isRecurring: boolean
    createdAt: Date
    updatedAt: Date
    deletedAt?: Date | null
    userId: string
}
