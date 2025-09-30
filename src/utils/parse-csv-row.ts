import { ParsedTransaction } from '@/core/dtos/parsed-transaction.dto'
import { TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'

export function parseCsvRow(
    row: Record<string, string>,
    headerMap: Record<string, keyof ParsedTransaction>
): Partial<ParsedTransaction> {
    const transaction: Partial<ParsedTransaction> = {}

    for (const [csvKey, rawValue] of Object.entries(row)) {
        const field = headerMap[csvKey]
        if (!field || !rawValue.trim()) continue

        const value = rawValue.trim()

        switch (field) {
            case 'amount':
                transaction.amount = Number.parseFloat(
                    value.replace('R$', '').replace(/\./g, '').replace(',', '.')
                )
                break

            case 'date':
                transaction.date = value.includes('/')
                    ? new Date(value.split('/').reverse().join('-'))
                    : new Date(value)
                break

            case 'name':
                transaction.name = value
                break

            case 'type':
                if (Object.values(TransactionType).includes(value as TransactionType)) {
                    transaction.type = value as TransactionType
                }
                break

            case 'category':
                if (Object.values(TransactionCategory).includes(value as TransactionCategory)) {
                    transaction.category = value as TransactionCategory
                }
                break

            case 'paymentMethod':
                if (
                    Object.values(TransactionPaymentMethod).includes(value as TransactionPaymentMethod)
                ) {
                    transaction.paymentMethod = value as TransactionPaymentMethod
                }
                break
        }
    }

    return transaction
}
