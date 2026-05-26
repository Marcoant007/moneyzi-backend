import type { TransactionRepository } from '@/application/repositories/transaction-repository'

export class CountCurrentMonthTransactionsUseCase {
    constructor(private transactionRepository: TransactionRepository) {}

    async execute(userId: string): Promise<number> {
        return this.transactionRepository.countCurrentMonth(userId)
    }
}
