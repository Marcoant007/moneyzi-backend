import type { TransactionRepository } from '@/application/repositories/transaction-repository'

interface ListTransactionsInput {
    userId: string
    month: number
    year: number
    accountId?: string
}

export class ListTransactionsUseCase {
    constructor(private transactionRepository: TransactionRepository) {}

    async execute(input: ListTransactionsInput) {
        return this.transactionRepository.findMany(input.userId, {
            month: input.month,
            year: input.year,
            accountId: input.accountId,
        })
    }
}
