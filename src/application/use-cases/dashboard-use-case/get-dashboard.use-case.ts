import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { AccountRepository } from '@/application/repositories/account-repository'
import type { Prisma, TransactionType } from '@prisma/client'
import { MoneyUtils } from '@/utils/money.utils'

const TRANSACTION_CATEGORY_LABELS: Record<string, string> = {
    EDUCATION: 'Educacao',
    ENTERTAINMENT: 'Entretenimento',
    SERVICES: 'Servicos',
    FOOD: 'Alimentacao',
    FOOD_DELIVERY: 'Lanche',
    GAMING: 'Jogos',
    HEALTH: 'Saude',
    HOUSING: 'Moradia',
    OTHER: 'Outros',
    SALARY: 'Salario',
    TRANSPORTATION: 'Transporte',
    SIGNATURE: 'Assinatura',
    STREAMING: 'Streaming',
    UTILITY: 'Utilidades',
}

type DashboardTransaction = Prisma.TransactionGetPayload<{ include: { creditCard: true } }>

type PaidCardStatementGroup = {
    groupKey: string
    creditCardId: string
    cardName: string
    statementDueDate: Date
    movementDate: Date
    totalAmount: number
    transactions: DashboardTransaction[]
}

type CategoryExpenseTransactionOutput = {
    id: string
    name: string
    amount: number
    date: Date
    paymentMethod: string
    type: TransactionType
}

export class GetDashboardUseCase {
    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly categoryRepository: CategoryRepository,
        private readonly accountRepository?: AccountRepository,
    ) { }

    async execute(input?: { userId?: string; month?: string; year?: string }) {
        const now = new Date()
        const currentYear = now.getFullYear()
        const targetYear = input?.year ? parseInt(input.year) : currentYear

        const monthIndex = input?.month ? parseInt(input.month) - 1 : now.getMonth()
        const startOfMonth = new Date(targetYear, monthIndex, 1)
        const endOfMonth = new Date(targetYear, monthIndex + 1, 1)
        const range = { start: startOfMonth, end: endOfMonth }

        const [dashboardTransactions, userCategories, userAccounts] = await Promise.all([
            input?.userId
                ? this.transactionRepository.findDashboardTransactions(input.userId, range)
                : Promise.resolve([]),
            input?.userId
                ? this.categoryRepository.listByUserId(input.userId)
                : Promise.resolve([]),
            input?.userId && this.accountRepository
                ? this.accountRepository.listByUserIdWithBalance(input.userId)
                : Promise.resolve([]),
        ])

        const SAVINGS_ACCOUNT_TYPES = ['PIGGY_BANK', 'SAVINGS', 'INVESTMENT']
        const isLinkedToSavingsAccount = (t: DashboardTransaction) =>
            !!(t as any).account && SAVINGS_ACCOUNT_TYPES.includes((t as any).account.type)

        const mainTransactions = dashboardTransactions.filter((t) => !isLinkedToSavingsAccount(t))

        const cardGroups = this.groupPaidCardStatements(mainTransactions)
        const nonCardTransactions = mainTransactions.filter((transaction) => !transaction.creditCardId)

        const depositsTotal = nonCardTransactions
            .filter((transaction) => transaction.type === 'DEPOSIT')
            .map((transaction) => Number(transaction.amount))
        const normalizedDepositsTotal = MoneyUtils.sum(depositsTotal)

        const investmentsTotal = nonCardTransactions
            .filter((transaction) => transaction.type === 'INVESTMENT')
            .map((transaction) => Number(transaction.amount))
        const normalizedInvestmentsTotal = MoneyUtils.sum(investmentsTotal)

        const investmentsPortfolioTotal = userAccounts
            .filter((account) => account.type === 'INVESTMENT' || account.type === 'PIGGY_BANK')
            .map((account) => Number(account.balance || 0))
        const normalizedInvestmentsPortfolioTotal = MoneyUtils.sum(investmentsPortfolioTotal)

        const nonCardExpensesTotal = nonCardTransactions
            .filter((transaction) => transaction.type === 'EXPENSE')
            .map((transaction) => Number(transaction.amount))
        const normalizedNonCardExpensesTotal = MoneyUtils.sum(nonCardExpensesTotal)

        const cardExpensesTotal = MoneyUtils.sum(cardGroups.map((group) => group.totalAmount))
        const expensesTotal = MoneyUtils.add(normalizedNonCardExpensesTotal, cardExpensesTotal)

        const balance = MoneyUtils.subtract(normalizedDepositsTotal, expensesTotal)
        const transactionsTotal = MoneyUtils.sum([
            normalizedDepositsTotal,
            normalizedInvestmentsTotal,
            expensesTotal,
        ])

        const typesPercentage = {
            DEPOSIT: transactionsTotal ? Math.round((normalizedDepositsTotal / transactionsTotal) * 100) : 0,
            INVESTMENT: transactionsTotal ? Math.round((normalizedInvestmentsTotal / transactionsTotal) * 100) : 0,
            EXPENSE: transactionsTotal ? Math.round((expensesTotal / transactionsTotal) * 100) : 0,
        }

        const categoryMap = new Map(userCategories.map(c => [c.id, c.name]))
        const categoriesDataMap = new Map<string, number>()
        const categoryTransactionsMap = new Map<string, CategoryExpenseTransactionOutput[]>()

        nonCardTransactions
            .filter((transaction) => transaction.type === 'EXPENSE')
            .forEach((transaction) => {
                const amount = Number(transaction.amount || 0)
                if (MoneyUtils.isZero(amount)) return

                const categoryName = this.resolveCategoryName(transaction, categoryMap)
                const current = categoriesDataMap.get(categoryName) || 0
                categoriesDataMap.set(categoryName, MoneyUtils.add(current, amount))
                this.pushCategoryTransaction(
                    categoryTransactionsMap,
                    categoryName,
                    transaction,
                    amount,
                )
            })

        cardGroups
            .flatMap((group) => group.transactions)
            .forEach((transaction) => {
                const amount = Number(transaction.amount || 0)
                if (MoneyUtils.isZero(amount)) return

                let signedAmount = 0
                if (transaction.type === 'EXPENSE') {
                    signedAmount = amount
                } else if (transaction.type === 'DEPOSIT') {
                    // Card deposits represent statement refunds/reversals.
                    signedAmount = -amount
                }

                if (MoneyUtils.isZero(signedAmount)) return

                const categoryName = this.resolveCategoryName(transaction, categoryMap)
                const current = categoriesDataMap.get(categoryName) || 0
                categoriesDataMap.set(categoryName, MoneyUtils.add(current, signedAmount))
                this.pushCategoryTransaction(
                    categoryTransactionsMap,
                    categoryName,
                    transaction,
                    signedAmount,
                )
            })

        const totalExpensePerCategory = Array.from(categoriesDataMap.entries())
            .filter(([, amount]) => !MoneyUtils.isZero(amount))
            .map(([category, amount]) => ({
                category,
                totalAmount: MoneyUtils.round(amount),
                percentageOfTotal: expensesTotal ? Math.round((amount / expensesTotal) * 100) : 0,
                transactions: (categoryTransactionsMap.get(category) || [])
                    .slice()
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
            }))
            .sort((a, b) => b.totalAmount - a.totalAmount)

        const normalizedNonCardTransactions = nonCardTransactions.map((transaction) => {
            const movementDate = this.resolveMovementDate(transaction)
            return {
                ...transaction,
                amount: Number(transaction.amount),
                date: movementDate,
            }
        })

        const syntheticCardTransactions = cardGroups.map((group) => ({
            id: `card-statement-${group.groupKey}`,
            name: `Fatura ${group.cardName}`,
            description: null,
            type: 'EXPENSE' as TransactionType,
            amount: MoneyUtils.round(group.totalAmount),
            category: 'OTHER',
            paymentMethod: 'CREDIT_CARD',
            date: group.movementDate,
            dueDate: group.statementDueDate,
            paidAt: group.movementDate,
            isRecurring: false,
            createdAt: group.movementDate,
            updatedAt: group.movementDate,
            userId: input?.userId ?? '',
            categoryId: null,
            creditCardId: group.creditCardId,
            creditCard: null,
            accountId: null,
            paymentStatus: 'PAID',
            deletedAt: null,
            importJobId: null,
        }))

        const lastTransactions = [
            ...normalizedNonCardTransactions,
            ...syntheticCardTransactions,
        ]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 10)

        return {
            balance,
            depositsTotal: normalizedDepositsTotal,
            investmentsTotal: normalizedInvestmentsTotal,
            investmentsPortfolioTotal: normalizedInvestmentsPortfolioTotal,
            expensesTotal,
            typesPercentage,
            totalExpensePerCategory,
            lastTransactions,
        }
    }

    private resolveMovementDate(transaction: DashboardTransaction): Date {
        if (transaction.type === 'INVESTMENT') return transaction.date
        return transaction.paidAt ?? transaction.dueDate ?? transaction.date
    }

    private resolveCategoryName(
        transaction: DashboardTransaction,
        categoryMap: Map<string, string>
    ): string {
        if (transaction.categoryId) {
            return categoryMap.get(transaction.categoryId) || 'Desconhecido'
        }

        if (transaction.category) {
            return TRANSACTION_CATEGORY_LABELS[transaction.category] || 'Outros'
        }

        return 'Outros'
    }

    private pushCategoryTransaction(
        categoryTransactionsMap: Map<string, CategoryExpenseTransactionOutput[]>,
        categoryName: string,
        transaction: DashboardTransaction,
        signedAmount: number,
    ) {
        if (!categoryTransactionsMap.has(categoryName)) {
            categoryTransactionsMap.set(categoryName, [])
        }

        categoryTransactionsMap.get(categoryName)!.push({
            id: transaction.id,
            name: transaction.name,
            amount: MoneyUtils.round(signedAmount),
            date: transaction.date,
            paymentMethod: transaction.paymentMethod,
            type: transaction.type,
        })
    }

    private groupPaidCardStatements(transactions: Array<DashboardTransaction>): PaidCardStatementGroup[] {
        const groups = new Map<string, PaidCardStatementGroup>()

        for (const transaction of transactions) {
            if (!transaction.creditCardId) continue
            if (transaction.paymentStatus !== 'PAID') continue

            const statementDueDate = this.resolveCardStatementDueDate(transaction)
            if (!statementDueDate) continue

            const groupKey = `${transaction.creditCardId}__${statementDueDate.getFullYear()}-${statementDueDate.getMonth()}`

            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    groupKey,
                    creditCardId: transaction.creditCardId,
                    cardName: transaction.creditCard?.name ?? 'Cartao',
                    statementDueDate,
                    movementDate: this.resolveMovementDate(transaction),
                    totalAmount: 0,
                    transactions: [],
                })
            }

            const group = groups.get(groupKey)!
            const amount = Number(transaction.amount)
            group.transactions.push(transaction)

            if (transaction.type === 'DEPOSIT') {
                group.totalAmount = MoneyUtils.subtract(group.totalAmount, amount)
            } else {
                group.totalAmount = MoneyUtils.add(group.totalAmount, amount)
            }

            const movementDate = this.resolveMovementDate(transaction)
            if (movementDate > group.movementDate) {
                group.movementDate = movementDate
            }
        }

        return Array.from(groups.values()).filter((group) => MoneyUtils.toCents(group.totalAmount) > 0)
    }

    private resolveCardStatementDueDate(transaction: DashboardTransaction): Date | null {
        if (transaction.dueDate) return transaction.dueDate

        const dueDay = transaction.creditCard?.dueDay ?? null
        if (!dueDay) return null

        return this.computeCardDueDate(
            transaction.date,
            dueDay,
            transaction.creditCard?.closingDay ?? undefined,
        )
    }

    private computeCardDueDate(transactionDate: Date, dueDay: number, closingDay?: number): Date {
        const year = transactionDate.getFullYear()
        const month = transactionDate.getMonth()
        const txDay = transactionDate.getDate()

        const monthOffset = closingDay
            ? (txDay > closingDay ? 2 : 1)
            : (txDay > dueDay ? 1 : 0)

        const dueYear = year + Math.floor((month + monthOffset) / 12)
        const dueMonth = (month + monthOffset) % 12
        const lastDay = new Date(dueYear, dueMonth + 1, 0).getDate()
        const safeDueDay = Math.max(1, Math.min(dueDay, lastDay))

        return new Date(dueYear, dueMonth, safeDueDay, 12, 0, 0, 0)
    }
}
