import type { AccountRepository } from '@/application/repositories/account-repository'
import type { TransferRepository } from '@/core/repositories/transfer-repository'

interface CreateTransferInput {
    userId: string
    fromAccountId: string
    toAccountId: string
    amount: number
    note?: string
    date?: Date
}

export class CreateTransferUseCase {
    constructor(
        private readonly transferRepository: TransferRepository,
        private readonly accountRepository: AccountRepository,
    ) {}

    async execute(input: CreateTransferInput) {
        if (input.fromAccountId === input.toAccountId) {
            throw new Error('FROM_EQUALS_TO')
        }

        if (input.amount <= 0) {
            throw new Error('INVALID_AMOUNT')
        }

        const [fromAccount, toAccount] = await Promise.all([
            this.accountRepository.findById(input.userId, input.fromAccountId),
            this.accountRepository.findById(input.userId, input.toAccountId),
        ])

        if (!fromAccount) throw new Error('FROM_ACCOUNT_NOT_FOUND')
        if (!toAccount) throw new Error('TO_ACCOUNT_NOT_FOUND')

        return this.transferRepository.create(input)
    }
}
