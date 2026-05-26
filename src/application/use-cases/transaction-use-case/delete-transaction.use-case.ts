import type { TransactionRepository } from '@/application/repositories/transaction-repository'

export class DeleteTransactionUseCase {
    constructor(private transactionRepository: TransactionRepository) {}

    async execute(id: string, userId: string): Promise<void> {
        await this.transactionRepository.hardDelete(id, userId)
    }
}
