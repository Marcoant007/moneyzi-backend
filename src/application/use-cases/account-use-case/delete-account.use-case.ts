import type { AccountRepository } from '@/application/repositories/account-repository'

export class DeleteAccountUseCase {
    constructor(private accountRepository: AccountRepository) { }

    async execute(userId: string, id: string): Promise<void> {
        await this.accountRepository.delete(userId, id)
    }
}
