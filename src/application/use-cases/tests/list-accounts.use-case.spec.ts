import { describe, expect, it, vi } from 'vitest'
import { ListAccountsUseCase } from '../account-use-case/list-accounts.use-case'

describe('ListAccountsUseCase', () => {
    it('should return accounts with total balance', async () => {
        const accountRepository = {
            listByUserIdWithBalance: vi.fn().mockResolvedValue([
                { id: 'a1', name: 'Inter', balance: 800 },
                { id: 'a2', name: 'Porquinho', balance: 200 },
            ]),
        } as any

        const sut = new ListAccountsUseCase(accountRepository)

        const result = await sut.execute('user-1')

        expect(accountRepository.listByUserIdWithBalance).toHaveBeenCalledWith('user-1')
        expect(result.totalBalance).toBe(1000)
        expect(result.accounts).toHaveLength(2)
    })
})
