import type { TransactionRepository } from '@/application/repositories/transaction-repository'

export class GetDashboardUseCase {
    constructor(private readonly transactionRepository: TransactionRepository) { }

    async execute(input?: { userId?: string }) {
        const totalsByType = await this.transactionRepository.groupTotalsByType(input?.userId)

        const now = new Date()
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

        const monthly = await this.transactionRepository.aggregateMonthlyAmount({
            start: startOfMonth,
            end: endOfMonth,
            userId: input?.userId,
        })

        return { totalsByType, monthly }
    }
}
