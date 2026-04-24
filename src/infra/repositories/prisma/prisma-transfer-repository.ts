import type { Transfer } from '@prisma/client'
import type { CreateTransferData, TransferRepository } from '@/core/repositories/transfer-repository'
import { prisma } from '@/lib/prisma'

export class PrismaTransferRepository implements TransferRepository {
    async create(data: CreateTransferData): Promise<Transfer> {
        return prisma.transfer.create({
            data: {
                userId: data.userId,
                fromAccountId: data.fromAccountId,
                toAccountId: data.toAccountId,
                amount: String(data.amount),
                note: data.note,
                date: data.date ?? new Date(),
            },
        })
    }

    async listByUserId(userId: string): Promise<Transfer[]> {
        return prisma.transfer.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
        })
    }
}
