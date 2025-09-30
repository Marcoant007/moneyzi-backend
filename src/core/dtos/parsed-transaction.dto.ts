import { TransactionType, TransactionPaymentMethod, TransactionCategory } from '@prisma/client'

export interface ParsedTransaction {
    name: string
    amount: number
    date: Date
    type?: TransactionType
    category?: TransactionCategory
    paymentMethod?: TransactionPaymentMethod
}
