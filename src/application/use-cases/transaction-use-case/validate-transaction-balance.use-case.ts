import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { AccountRepository } from '@/application/repositories/account-repository'

export interface ValidateTransactionBalanceInput {
    userId: string
    accountId: string
    type: 'DEPOSIT' | 'EXPENSE' | 'INVESTMENT'
    amount: number
}

/**
 * Extraído de UpsertTransactionUseCase (era um método privado ali) pra poder
 * ser reaproveitado por CreateTransactionForMcpUseCase sem duplicar a regra.
 * Comportamento idêntico ao original — mesma checagem de EXPENSE acima do
 * saldo da conta e de DEPOSIT em conta poupança/investimento acima do
 * disponível no total de contas.
 */
export class ValidateTransactionBalanceUseCase {
    constructor(
        private transactionRepository: TransactionRepository,
        private accountRepository: AccountRepository,
    ) {}

    async execute(input: ValidateTransactionBalanceInput): Promise<void> {
        const account = await this.accountRepository.findById(input.userId, input.accountId)
        if (!account) return

        const grouped = await this.transactionRepository.groupAccountMovements(input.userId, input.accountId)
        const movement = grouped.reduce((sum, t) => {
            const signal = t.type === 'EXPENSE' ? -1 : 1
            return sum + Number(t._sum.amount || 0) * signal
        }, 0)
        const balance = Number(account.initialBalance || 0) + movement

        if (input.type === 'EXPENSE' && input.amount > balance) {
            throw new Error('INSUFFICIENT_BALANCE')
        }

        const isSavingsAccount = ['PIGGY_BANK', 'SAVINGS', 'INVESTMENT'].includes(account.type)
        if (input.type === 'DEPOSIT' && isSavingsAccount) {
            const allAccounts = await this.accountRepository.listByUserIdWithBalance(input.userId)
            const totalBalance = allAccounts.reduce((sum, acc) => sum + acc.balance, 0)
            const available = totalBalance - balance
            if (input.amount > available) {
                throw new Error('INSUFFICIENT_BALANCE')
            }
        }
    }
}
