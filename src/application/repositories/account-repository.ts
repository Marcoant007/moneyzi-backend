import type { Account, AccountType } from '@prisma/client'

export interface CreateAccountData {
    userId: string
    name: string
    type: AccountType
    initialBalance?: number
    color?: string
    icon?: string
}

export interface UpdateAccountData {
    name?: string
    type?: AccountType
    initialBalance?: number
    color?: string | null
    icon?: string | null
    isActive?: boolean
}

export interface AccountWithBalance extends Account {
    balance: number
}

export interface AccountRepository {
    create(data: CreateAccountData): Promise<Account>
    findById(userId: string, id: string): Promise<Account | null>
    listByUserIdWithBalance(userId: string): Promise<AccountWithBalance[]>
    update(userId: string, id: string, data: UpdateAccountData): Promise<Account>
    delete(userId: string, id: string): Promise<void>
}
