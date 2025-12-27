import { prisma } from '@/lib/prisma'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Prisma } from '@prisma/client'

export class PrismaTransactionRepository implements TransactionRepository {
    async create(data: Prisma.TransactionUncheckedCreateInput): Promise<void> {
        await prisma.transaction.create({ data })
    }

    async groupTotalsByType(userId?: string, range?: { start: Date; end: Date }) {
        return prisma.transaction.groupBy({
            by: ['type'],
            where: {
                ...(userId ? { userId } : {}),
                ...(range ? { date: { gte: range.start, lt: range.end } } : {}),
            },
            _sum: { amount: true },
        })
    }

    async groupExpensesByCategory(userId?: string, range?: { start: Date; end: Date }) {
        return prisma.transaction.groupBy({
            by: ['category'],
            where: {
                type: 'EXPENSE',
                ...(userId ? { userId } : {}),
                ...(range ? { date: { gte: range.start, lt: range.end } } : {}),
            },
            _sum: { amount: true },
        })
    }

    async groupExpensesByCategoryId(userId: string, range?: { start: Date; end: Date }) {
        return prisma.transaction.groupBy({
            by: ['categoryId'],
            where: {
                userId,
                type: 'EXPENSE',
                categoryId: { not: null },
                ...(range ? { date: { gte: range.start, lt: range.end } } : {})
            },
            _sum: { amount: true }
        })
    }

    async groupExpensesByRecurrence(userId: string, range?: { start: Date; end: Date }) {
        return prisma.transaction.groupBy({
            by: ['isRecurring'],
            where: {
                userId,
                type: 'EXPENSE',
                ...(range ? { date: { gte: range.start, lt: range.end } } : {})
            },
            _sum: { amount: true }
        })
    }

    async findLastTransactions(userId?: string, take: number = 10) {
        return prisma.transaction.findMany({
            where: userId ? { userId } : undefined,
            orderBy: { date: 'desc' },
            take,
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
