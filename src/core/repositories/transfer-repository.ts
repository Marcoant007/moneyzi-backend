import type { Transfer } from '@prisma/client'

export interface CreateTransferData {
    userId: string
    fromAccountId: string
    toAccountId: string
    amount: number
    note?: string
    date?: Date
}

export interface TransferRepository {
    create(data: CreateTransferData): Promise<Transfer>
    listByUserId(userId: string): Promise<Transfer[]>
}
