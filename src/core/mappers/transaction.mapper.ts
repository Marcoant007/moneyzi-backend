import type { Transaction as PrismaTransaction } from '@prisma/client'
import { TransactionDto } from '@/core/dtos/transaction.dto'

export function toTransactionDto(saved: PrismaTransaction): TransactionDto {
    return {
        id: saved.id,
        name: saved.name,
        description: saved.description ?? null,
        type: saved.type,
        amount: saved.amount.toString(),
        importJobId: saved.importJobId ?? null,
        category: saved.category,
        paymentMethod: saved.paymentMethod,
        date: saved.date,
        isRecurring: saved.isRecurring,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        deletedAt: saved.deletedAt ?? null,
        userId: saved.userId,
    }
}
