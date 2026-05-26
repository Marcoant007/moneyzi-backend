import type { TransactionRepository } from '@/application/repositories/transaction-repository'

export class UpdateTransactionAmountUseCase {
    constructor(private transactionRepository: TransactionRepository) {}

    async execute(id: string, userId: string, amount: number): Promise<void> {
        await this.transactionRepository.updateAmount(id, userId, amount)
    }
}
