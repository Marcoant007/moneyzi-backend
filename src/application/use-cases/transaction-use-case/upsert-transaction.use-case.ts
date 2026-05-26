import { z } from 'zod'
import type { TransactionRepository, UpsertTransactionData } from '@/application/repositories/transaction-repository'
import type { AccountRepository } from '@/application/repositories/account-repository'

const upsertTransactionSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    amount: z.number().positive(),
    type: z.enum(['DEPOSIT', 'EXPENSE', 'INVESTMENT']),
    category: z.enum(['HOUSING', 'TRANSPORTATION', 'FOOD', 'ENTERTAINMENT', 'HEALTH', 'UTILITY', 'SALARY', 'EDUCATION', 'OTHER', 'SIGNATURE', 'FOOD_DELIVERY', 'GAMING', 'SERVICES', 'STREAMING']),
    categoryId: z.string().optional().nullable(),
    accountId: z.string().optional().nullable(),
    creditCardId: z.string().optional().nullable(),
    paymentMethod: z.enum(['CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'BANK_SLIP', 'CASH', 'PIX', 'OTHER']),
    date: z.coerce.date(),
    dueDate: z.coerce.date().optional().nullable(),
    isRecurring: z.boolean().optional(),
    paymentStatus: z.enum(['PAID', 'PENDING']).optional(),
    userId: z.string().min(1),
})

type UpsertInput = z.infer<typeof upsertTransactionSchema>

export class UpsertTransactionUseCase {
    constructor(
        private transactionRepository: TransactionRepository,
        private accountRepository: AccountRepository,
    ) {}

    async execute(input: UpsertInput): Promise<void> {
        const parsed = upsertTransactionSchema.parse(input)

        if (parsed.accountId && !parsed.id) {
            await this.validateBalance(parsed)
        }

        await this.transactionRepository.upsert(parsed as UpsertTransactionData)
    }

    private async validateBalance(parsed: UpsertInput) {
        const account = await this.accountRepository.findById(parsed.userId, parsed.accountId!)
        if (!account) return

        const grouped = await this.transactionRepository.groupAccountMovements(parsed.userId, parsed.accountId!)
        const movement = grouped.reduce((sum, t) => {
            const signal = t.type === 'EXPENSE' ? -1 : 1
            return sum + Number(t._sum.amount || 0) * signal
        }, 0)
        const balance = Number(account.initialBalance || 0) + movement

        if (parsed.type === 'EXPENSE' && parsed.amount > balance) {
            throw new Error('INSUFFICIENT_BALANCE')
        }

        const isSavingsAccount = ['PIGGY_BANK', 'SAVINGS', 'INVESTMENT'].includes(account.type)
        if (parsed.type === 'DEPOSIT' && isSavingsAccount) {
            const allAccounts = await this.accountRepository.listByUserIdWithBalance(parsed.userId)
            const totalBalance = allAccounts.reduce((sum, acc) => sum + acc.balance, 0)
            const available = totalBalance - balance
            if (parsed.amount > available) {
                throw new Error('INSUFFICIENT_BALANCE')
            }
        }
    }
}
