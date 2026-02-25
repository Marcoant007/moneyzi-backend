import type { Account, Prisma } from '@prisma/client'
import type {
    AccountRepository,
    AccountWithBalance,
    CreateAccountData,
    UpdateAccountData,
} from '@/application/repositories/account-repository'
import { prisma } from '@/lib/prisma'

export class PrismaAccountRepository implements AccountRepository {
    async create(data: CreateAccountData): Promise<Account> {
        return prisma.account.create({
            data: {
                ...data,
                initialBalance:
                    data.initialBalance !== undefined ? String(data.initialBalance) : undefined,
            },
        })
    }

    async findById(userId: string, id: string): Promise<Account | null> {
        return prisma.account.findFirst({
            where: { id, userId },
        })
    }

    async listByUserIdWithBalance(userId: string): Promise<AccountWithBalance[]> {
        const [accounts, groupedTransactions] = await Promise.all([
            prisma.account.findMany({
                where: {
                    userId,
                    isActive: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            }),
            prisma.transaction.groupBy({
                by: ['accountId', 'type'],
                where: {
                    userId,
                    accountId: { not: null },
                    deletedAt: null,
                },
                _sum: {
                    amount: true,
                },
            }),
        ])

        const movementByAccount = new Map<string, number>()

        groupedTransactions.forEach((item) => {
            if (!item.accountId) return

            const value = Number(item._sum.amount || 0)
            const signal =
                item.type === 'EXPENSE'
                    ? -1
                    : item.type === 'DEPOSIT' || item.type === 'INVESTMENT'
                        ? 1
                        : 0

            const current = movementByAccount.get(item.accountId) || 0
            movementByAccount.set(item.accountId, current + value * signal)
        })

        return accounts.map((account) => {
            const initial = Number(account.initialBalance || 0)
            const movement = movementByAccount.get(account.id) || 0

            return {
                ...account,
                balance: initial + movement,
            }
        })
    }

    async update(userId: string, id: string, data: UpdateAccountData): Promise<Account> {
        const existing = await this.findById(userId, id)

        if (!existing) {
            throw new Error('Account not found')
        }

        const payload: Prisma.AccountUpdateInput = {
            ...data,
            initialBalance:
                data.initialBalance !== undefined ? String(data.initialBalance) : undefined,
        }

        return prisma.account.update({
            where: { id },
            data: payload,
        })
    }

    async delete(userId: string, id: string): Promise<void> {
        const existing = await this.findById(userId, id)

        if (!existing) {
            throw new Error('Account not found')
        }

        await prisma.account.delete({
            where: { id },
        })
    }
}
