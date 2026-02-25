import type { AccountRepository } from '@/application/repositories/account-repository'

export class ListAccountsUseCase {
    constructor(private accountRepository: AccountRepository) { }

    async execute(userId: string) {
        const accounts = await this.accountRepository.listByUserIdWithBalance(userId)
        const totalBalance = accounts.reduce((acc, account) => acc + account.balance, 0)

        return {
            totalBalance,
            accounts,
        }
    }
}
