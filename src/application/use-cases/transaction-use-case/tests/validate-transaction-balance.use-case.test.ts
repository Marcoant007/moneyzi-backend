import { describe, expect, it, vi } from 'vitest'
import { ValidateTransactionBalanceUseCase } from '../validate-transaction-balance.use-case'

// Migrado dos cenários de saldo que antes viviam em
// upsert-transaction.use-case.spec.ts (agora testados direto contra a
// classe extraída; UpsertTransactionUseCase continua coberto separadamente
// e serve de rede de segurança de que a extração não mudou comportamento).
function makeRepositories(overrides?: {
    findById?: any
    groupAccountMovements?: any
    listByUserIdWithBalance?: any
}) {
    const transactionRepository = {
        groupAccountMovements: overrides?.groupAccountMovements ?? vi.fn().mockResolvedValue([]),
    } as any

    const accountRepository = {
        findById: overrides?.findById ?? vi.fn().mockResolvedValue(null),
        listByUserIdWithBalance: overrides?.listByUserIdWithBalance ?? vi.fn().mockResolvedValue([]),
    } as any

    return { transactionRepository, accountRepository }
}

describe('ValidateTransactionBalanceUseCase', () => {
    it('não valida nada se a conta não for encontrada (deixa passar)', async () => {
        const { transactionRepository, accountRepository } = makeRepositories()
        const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

        await expect(
            sut.execute({ userId: 'user-1', accountId: 'acc-x', type: 'EXPENSE', amount: 100 }),
        ).resolves.toBeUndefined()
    })

    describe('EXPENSE em conta', () => {
        // Conta: initialBalance 0 + depósito 100 = saldo R$ 100
        function setupExpenseMocks() {
            return makeRepositories({
                findById: vi.fn().mockResolvedValue({ initialBalance: '0', type: 'CHECKING' }),
                groupAccountMovements: vi.fn().mockResolvedValue([
                    { type: 'DEPOSIT', _sum: { amount: '100' } },
                ]),
            })
        }

        it('lança INSUFFICIENT_BALANCE ao retirar mais do que o saldo', async () => {
            const { transactionRepository, accountRepository } = setupExpenseMocks()
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'EXPENSE', amount: 150 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')
        })

        it('permite retirada dentro do saldo disponível', async () => {
            const { transactionRepository, accountRepository } = setupExpenseMocks()
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'EXPENSE', amount: 50 }),
            ).resolves.toBeUndefined()
        })

        it('permite retirada com valor exatamente igual ao saldo', async () => {
            const { transactionRepository, accountRepository } = setupExpenseMocks()
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'EXPENSE', amount: 100 }),
            ).resolves.toBeUndefined()
        })
    })

    describe('DEPOSIT em conta de reserva (PIGGY_BANK / SAVINGS / INVESTMENT)', () => {
        // acc-1 (reserva) saldo = 100 | acc-2 (CHECKING) saldo = 200
        // totalBalance = 300, disponível para depositar = 300 - 100 = 200
        function setupSavingsMocks(accountType = 'PIGGY_BANK') {
            return makeRepositories({
                findById: vi.fn().mockResolvedValue({ initialBalance: '0', type: accountType }),
                groupAccountMovements: vi.fn().mockResolvedValue([
                    { type: 'DEPOSIT', _sum: { amount: '100' } },
                ]),
                listByUserIdWithBalance: vi.fn().mockResolvedValue([
                    { id: 'acc-1', balance: 100 },
                    { id: 'acc-2', balance: 200 },
                ]),
            })
        }

        it('lança INSUFFICIENT_BALANCE ao depositar além do saldo disponível', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks()
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'DEPOSIT', amount: 201 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')
        })

        it('permite depósito dentro do saldo disponível', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks()
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'DEPOSIT', amount: 199 }),
            ).resolves.toBeUndefined()
        })

        it('permite depósito com valor exatamente igual ao disponível', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks()
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'DEPOSIT', amount: 200 }),
            ).resolves.toBeUndefined()
        })

        it('aplica a mesma validação para conta SAVINGS', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks('SAVINGS')
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'DEPOSIT', amount: 201 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')
        })

        it('aplica a mesma validação para conta INVESTMENT', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks('INVESTMENT')
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'DEPOSIT', amount: 201 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')
        })

        it('não valida saldo disponível ao depositar em conta CHECKING', async () => {
            const { transactionRepository, accountRepository } = makeRepositories({
                findById: vi.fn().mockResolvedValue({ initialBalance: '0', type: 'CHECKING' }),
                groupAccountMovements: vi.fn().mockResolvedValue([]),
            })
            const sut = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)

            await sut.execute({ userId: 'user-1', accountId: 'acc-1', type: 'DEPOSIT', amount: 9999 })

            expect(accountRepository.listByUserIdWithBalance).not.toHaveBeenCalled()
        })
    })
})
