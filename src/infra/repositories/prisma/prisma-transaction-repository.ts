import { prisma } from '@/lib/prisma'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Prisma } from '@prisma/client'

export class PrismaTransactionRepository implements TransactionRepository {
    async create(data: Prisma.TransactionUncheckedCreateInput): Promise<void> {
        await prisma.transaction.create({ data })
    }

    async groupTotalsByType(userId?: string) {
        return prisma.transaction.groupBy({
            by: ['type'],
            where: userId ? { userId } : undefined,
            _sum: { amount: true },
        })
    }

    async aggregateMonthlyAmount(range: { start: Date; end: Date; userId?: string }) {
        return prisma.transaction.aggregate({
            where: {
                date: { gte: range.start, lt: range.end },
                ...(range.userId ? { userId: range.userId } : {}),
            },
            _sum: { amount: true },
        })
    }
}
