import { describe, expect, it, vi, beforeEach } from 'vitest'
import { UpsertTransactionUseCase } from '../transaction-use-case/upsert-transaction.use-case'

const baseParams = {
    name: 'Conta de luz',
    amount: 120.5,
    type: 'EXPENSE' as const,
    category: 'HOUSING' as const,
    paymentMethod: 'PIX' as const,
    date: new Date('2026-02-10T00:00:00.000Z'),
    userId: 'user-1',
}

function makeRepositories(overrides?: {
    findById?: any
    groupAccountMovements?: any
    listByUserIdWithBalance?: any
    upsert?: any
}) {
    const transactionRepository = {
        upsert: overrides?.upsert ?? vi.fn().mockResolvedValue(undefined),
        groupAccountMovements: overrides?.groupAccountMovements ?? vi.fn().mockResolvedValue([]),
    } as any

    const accountRepository = {
        findById: overrides?.findById ?? vi.fn().mockResolvedValue(null),
        listByUserIdWithBalance: overrides?.listByUserIdWithBalance ?? vi.fn().mockResolvedValue([]),
    } as any

    return { transactionRepository, accountRepository }
}

describe('UpsertTransactionUseCase', () => {
    it('deve criar transação sem accountId sem validar saldo', async () => {
        const { transactionRepository, accountRepository } = makeRepositories()
        const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

        await sut.execute(baseParams)

        expect(accountRepository.findById).not.toHaveBeenCalled()
        expect(transactionRepository.upsert).toHaveBeenCalledOnce()
    })

    it('não deve validar saldo ao atualizar (id presente + accountId)', async () => {
        const { transactionRepository, accountRepository } = makeRepositories({
            findById: vi.fn().mockResolvedValue({ initialBalance: '0', type: 'CHECKING' }),
        })
        const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

        await sut.execute({ ...baseParams, id: 'tx-1', accountId: 'acc-1', amount: 9999 })

        expect(accountRepository.findById).not.toHaveBeenCalled()
        expect(transactionRepository.upsert).toHaveBeenCalledOnce()
    })

    it('deve lançar erro quando payload é inválido (amount zero)', async () => {
        const { transactionRepository, accountRepository } = makeRepositories()
        const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

        await expect(sut.execute({ ...baseParams, amount: 0 })).rejects.toThrow()
        expect(transactionRepository.upsert).not.toHaveBeenCalled()
    })

    describe('validação de saldo para EXPENSE em conta', () => {
        // Conta: initialBalance 0 + depósito 100 = saldo R$ 100
        function setupExpenseMocks(overrides?: { findById?: any; groupAccountMovements?: any }) {
            return makeRepositories({
                findById: overrides?.findById ?? vi.fn().mockResolvedValue({ initialBalance: '0', type: 'CHECKING' }),
                groupAccountMovements: overrides?.groupAccountMovements ?? vi.fn().mockResolvedValue([
                    { type: 'DEPOSIT', _sum: { amount: '100' } },
                ]),
            })
        }

        it('deve lançar INSUFFICIENT_BALANCE ao retirar mais do que o saldo', async () => {
            const { transactionRepository, accountRepository } = setupExpenseMocks()
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ ...baseParams, accountId: 'acc-1', type: 'EXPENSE', amount: 150 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')

            expect(transactionRepository.upsert).not.toHaveBeenCalled()
        })

        it('deve permitir retirada dentro do saldo disponível', async () => {
            const { transactionRepository, accountRepository } = setupExpenseMocks()
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await sut.execute({ ...baseParams, accountId: 'acc-1', type: 'EXPENSE', amount: 50 })

            expect(transactionRepository.upsert).toHaveBeenCalledOnce()
        })

        it('deve permitir retirada com valor exatamente igual ao saldo', async () => {
            const { transactionRepository, accountRepository } = setupExpenseMocks()
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await sut.execute({ ...baseParams, accountId: 'acc-1', type: 'EXPENSE', amount: 100 })

            expect(transactionRepository.upsert).toHaveBeenCalledOnce()
        })
    })

    describe('validação de saldo para DEPOSIT em conta de reserva (PIGGY_BANK / SAVINGS)', () => {
        // acc-1 (PIGGY_BANK) saldo = 100 | acc-2 (CHECKING) saldo = 200
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

        it('deve lançar INSUFFICIENT_BALANCE ao depositar além do saldo disponível', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks()
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ ...baseParams, accountId: 'acc-1', type: 'DEPOSIT', amount: 201 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')

            expect(transactionRepository.upsert).not.toHaveBeenCalled()
        })

        it('deve permitir depósito dentro do saldo disponível', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks()
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await sut.execute({ ...baseParams, accountId: 'acc-1', type: 'DEPOSIT', amount: 199 })

            expect(transactionRepository.upsert).toHaveBeenCalledOnce()
        })

        it('deve permitir depósito com valor exatamente igual ao disponível', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks()
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await sut.execute({ ...baseParams, accountId: 'acc-1', type: 'DEPOSIT', amount: 200 })

            expect(transactionRepository.upsert).toHaveBeenCalledOnce()
        })

        it('deve aplicar a mesma validação para conta SAVINGS', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks('SAVINGS')
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ ...baseParams, accountId: 'acc-1', type: 'DEPOSIT', amount: 201 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')
        })

        it('deve aplicar a mesma validação para conta INVESTMENT', async () => {
            const { transactionRepository, accountRepository } = setupSavingsMocks('INVESTMENT')
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await expect(
                sut.execute({ ...baseParams, accountId: 'acc-1', type: 'DEPOSIT', amount: 201 }),
            ).rejects.toThrow('INSUFFICIENT_BALANCE')
        })

        it('não deve validar saldo disponível ao depositar em conta CHECKING', async () => {
            const { transactionRepository, accountRepository } = makeRepositories({
                findById: vi.fn().mockResolvedValue({ initialBalance: '0', type: 'CHECKING' }),
                groupAccountMovements: vi.fn().mockResolvedValue([]),
            })
            const sut = new UpsertTransactionUseCase(transactionRepository, accountRepository)

            await sut.execute({ ...baseParams, accountId: 'acc-1', type: 'DEPOSIT', amount: 9999 })

            expect(accountRepository.listByUserIdWithBalance).not.toHaveBeenCalled()
            expect(transactionRepository.upsert).toHaveBeenCalledOnce()
        })
    })
})
