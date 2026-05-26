import type { TransactionRepository } from '@/application/repositories/transaction-repository'

function round(value: number): number {
    return Math.round(value * 100) / 100
}

export class UpdateCardStatementAmountUseCase {
    constructor(private transactionRepository: TransactionRepository) {}

    async execute(userId: string, transactionIds: string[], newTotal: number): Promise<void> {
        const normalizedNewTotal = round(newTotal)

        const transactions = await this.transactionRepository.findManyByIds(transactionIds, userId)
        if (transactions.length === 0) throw new Error('Nenhuma transação encontrada')

        const currentTotal = transactions.reduce((sum, t) => round(sum + Number(t.amount)), 0)
        const diff = round(normalizedNewTotal - currentTotal)

        if (Math.abs(diff) < 0.01) return

        const ref = transactions[0]
        await this.transactionRepository.create({
            name: 'Ajuste de fatura',
            type: diff > 0 ? 'EXPENSE' : 'DEPOSIT',
            amount: String(round(Math.abs(diff))),
            category: ref.category ?? 'OTHER',
            paymentMethod: ref.paymentMethod ?? 'CREDIT_CARD',
            date: ref.dueDate ?? new Date(),
            dueDate: ref.dueDate,
            creditCardId: ref.creditCardId,
            accountId: ref.accountId,
            userId,
        })
    }
}
