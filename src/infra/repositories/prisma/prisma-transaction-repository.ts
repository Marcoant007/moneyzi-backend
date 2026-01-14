import { prisma } from '@/lib/prisma'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { Prisma } from '@prisma/client'

export class PrismaTransactionRepository implements TransactionRepository {
    async create(data: Prisma.TransactionUncheckedCreateInput): Promise<void> {
        await prisma.transaction.create({ data })
    }

    async findByCategory(categoryId: string, userId: string, month?: string, year?: string) {
        const startDate = new Date(parseInt(year || '2024'), parseInt(month || '1') - 1, 1)
        const endDate = new Date(parseInt(year || '2024'), parseInt(month || '1'), 0)

        const transactions = await prisma.transaction.findMany({
            where: {
                categoryId,
                userId,
                date: {
                    gte: startDate,
                    lt: new Date(endDate.getTime() + 24 * 60 * 60 * 1000) // Add 1 day to include the last day
                }
            },
            select: {
                id: true,
                name: true,
                amount: true,
                date: true,
                paymentMethod: true,
            },
            orderBy: {
                date: 'desc'
            }
        })

        return transactions.map(t => ({
            id: t.id,
            name: t.name,
            amount: Number(t.amount),
            date: t.date,
            paymentMethod: t.paymentMethod || 'Não informado'
        }))
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
            by: ['category', 'categoryId'],
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
            by: ['categoryId', 'category'],
            where: {
                userId,
                type: 'EXPENSE',
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

    async findUpcoming(startDate: Date, endDate: Date) {
        try {
            console.log(`🔎 [REPOSITORY] Buscando transações vencendo entre ${startDate.toISOString()} e ${endDate.toISOString()}`)

            const transactions = await prisma.transaction.findMany({
                where: {
                    dueDate: {
                        lte: endDate,
                        gte: startDate,
                    },
                    deletedAt: null,
                    type: 'EXPENSE',
                },
                include: {
                    user: true,
                },
            })

            console.log(`📊 [REPOSITORY] ${transactions.length} transações encontradas`)

            return transactions.filter((t) => t.dueDate !== null) as any
        } catch (error) {
            console.error('❌ [REPOSITORY] Erro ao buscar transações vencendo:', error)
            throw error
        }
    }

    async findOverdue(currentDate: Date) {
        try {
            console.log(`🔎 [REPOSITORY] Buscando transações vencidas antes de ${currentDate.toISOString()}`)

            const transactions = await prisma.transaction.findMany({
                where: {
                    dueDate: {
                        lt: currentDate,
                    },
                    deletedAt: null,
                    type: 'EXPENSE',
                },
                include: {
                    user: true,
                },
            })

            console.log(`📊 [REPOSITORY] ${transactions.length} transações vencidas encontradas`)

            return transactions.filter((t) => t.dueDate !== null) as any
        } catch (error) {
            console.error('❌ [REPOSITORY] Erro ao buscar transações vencidas:', error)
            throw error
        }
    }
}
