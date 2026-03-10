import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import { MoneyUtils } from '@/utils/money.utils'
import type { Prisma, TransactionCategory } from '@prisma/client'

type DashboardTransaction = Prisma.TransactionGetPayload<{ include: { creditCard: true } }>

type BucketStatus = 'good' | 'warning' | 'bad'
type HealthStatus = 'healthy' | 'attention' | 'risk'
type PaymentMethodFocus = 'credit_card' | 'mixed' | 'other'

type CategorySummary = {
    category: string
    total: number
    incomePercent: number
}

type RawExpenseEntry = {
    amount: number
    category: string
    enumCategory: TransactionCategory
    isCustomCategory: boolean
    isRecurring: boolean
    paymentMethod: string
    isCreditCard: boolean
}

export interface MonthlySummaryOutput {
    month: string
    income: number
    expenses: number
    balance: number
    commitmentRate: number
    fixedExpenses: {
        total: number
        incomePercent: number
    }
    variableExpenses: {
        total: number
        incomePercent: number
        topCategory: CategorySummary | null
    }
    creditCardAnalysis: {
        total: number
        expensePercent: number
        variablePercent: number
        topCategory: {
            name: string
            total: number
        } | null
        isDominant: boolean
    }
    majorOffender: {
        category: string
        total: number
        incomePercent: number
        origin: 'variable' | 'credit_card' | 'fixed'
        paymentMethodFocus: PaymentMethodFocus
    } | null
    topOffenders: Array<{
        category: string
        total: number
        incomePercent: number
        paymentMethodFocus: PaymentMethodFocus
    }>
    rule503020: {
        needs: {
            idealPercent: 50
            actualPercent: number
            total: number
            status: BucketStatus
        }
        wants: {
            idealPercent: 30
            actualPercent: number
            total: number
            status: BucketStatus
        }
        future: {
            idealPercent: 20
            actualPercent: number
            total: number
            status: BucketStatus
        }
    }
    healthScore: {
        value: number
        status: HealthStatus
    }
    insights: string[]
}

const CATEGORY_LABELS: Record<TransactionCategory, string> = {
    EDUCATION: 'Educacao',
    ENTERTAINMENT: 'Entretenimento',
    SERVICES: 'Servicos',
    FOOD: 'Alimentacao',
    FOOD_DELIVERY: 'Delivery',
    GAMING: 'Jogos',
    HEALTH: 'Saude',
    HOUSING: 'Moradia',
    OTHER: 'Outros',
    SALARY: 'Salario',
    TRANSPORTATION: 'Transporte',
    SIGNATURE: 'Assinaturas',
    STREAMING: 'Streaming',
    UTILITY: 'Utilidades',
}

const FIXED_ENUM_CATEGORIES = new Set<TransactionCategory>([
    'HOUSING',
    'UTILITY',
    'SIGNATURE',
    'STREAMING',
    'EDUCATION',
    'HEALTH',
    'SERVICES',
])

const NEEDS_ENUM_CATEGORIES = new Set<TransactionCategory>([
    'HOUSING',
    'UTILITY',
    'HEALTH',
    'EDUCATION',
    'SERVICES',
    'TRANSPORTATION',
    'FOOD',
])

const WANTS_ENUM_CATEGORIES = new Set<TransactionCategory>([
    'FOOD_DELIVERY',
    'ENTERTAINMENT',
    'GAMING',
    'STREAMING',
    'SIGNATURE',
    'OTHER',
])

export class GetMonthlySummaryUseCase {
    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly categoryRepository: CategoryRepository,
    ) { }

    async execute(userId: string, month: string): Promise<MonthlySummaryOutput> {
        const range = this.parseMonthRange(month)

        const [transactions, userCategories] = await Promise.all([
            this.transactionRepository.findDashboardTransactions(userId, range),
            this.categoryRepository.listByUserId(userId),
        ])

        const categoryNameById = new Map(userCategories.map((category) => [category.id, category.name]))
        const income = this.computeIncome(transactions)
        const expenseEntries = this.buildExpenseEntries(transactions, categoryNameById)

        const rawExpenseTotal = MoneyUtils.sum(expenseEntries.map((entry) => entry.amount))
        const rawFixedTotal = MoneyUtils.sum(
            expenseEntries
                .filter((entry) => this.isFixedExpense(entry))
                .map((entry) => entry.amount),
        )
        const rawVariableTotal = MoneyUtils.sum(
            expenseEntries
                .filter((entry) => !this.isFixedExpense(entry))
                .map((entry) => entry.amount),
        )

        const expenses = this.clampMoney(rawExpenseTotal)
        const fixedTotal = this.clampMoney(rawFixedTotal)
        const variableTotal = this.clampMoney(rawVariableTotal)
        const balance = MoneyUtils.round(MoneyUtils.subtract(income, expenses))
        const commitmentRate = this.percentage(expenses, income)

        const variableTopCategory = this.findTopCategory(
            this.groupByCategory(expenseEntries.filter((entry) => !this.isFixedExpense(entry))),
            income,
        )
        const fixedTopCategory = this.findTopCategory(
            this.groupByCategory(expenseEntries.filter((entry) => this.isFixedExpense(entry))),
            income,
        )

        const creditCardEntries = expenseEntries.filter((entry) => entry.isCreditCard)
        const creditCardTotalRaw = MoneyUtils.sum(creditCardEntries.map((entry) => entry.amount))
        const creditCardTotal = this.clampMoney(creditCardTotalRaw)
        const creditCardTopCategorySummary = this.findTopCategory(
            this.groupByCategory(creditCardEntries),
            income,
        )
        const creditCardTopCategory = creditCardTopCategorySummary
            ? {
                name: creditCardTopCategorySummary.category,
                total: creditCardTopCategorySummary.total,
            }
            : null

        const creditCardVariableTotal = this.clampMoney(
            MoneyUtils.sum(
                creditCardEntries
                    .filter((entry) => !this.isFixedExpense(entry))
                    .map((entry) => entry.amount),
            ),
        )

        const creditExpensePercent = this.percentage(creditCardTotal, expenses)
        const creditVariablePercent = this.percentage(creditCardVariableTotal, variableTotal)
        const cardDominant = creditExpensePercent >= 45

        const variableCategoryGroups = this.groupByCategoryWithPaymentFocus(
            expenseEntries.filter((entry) => !this.isFixedExpense(entry)),
        )
        const topOffenders = Array.from(variableCategoryGroups.values())
            .filter((category) => category.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5)
            .map((category) => ({
                category: category.name,
                total: MoneyUtils.round(category.total),
                incomePercent: this.percentage(category.total, income),
                paymentMethodFocus: this.resolvePaymentMethodFocus(category.methods),
            }))

        const majorOffender = this.resolveMajorOffender({
            cardDominant,
            variableTotal,
            fixedTotal,
            variableTopCategory,
            fixedTopCategory,
            creditCardTopCategory: creditCardTopCategorySummary,
            variableCategoryGroups,
            fixedCategoryGroups: this.groupByCategoryWithPaymentFocus(
                expenseEntries.filter((entry) => this.isFixedExpense(entry)),
            ),
            income,
        })

        const rule503020 = this.calculateRule503020(expenseEntries, income, balance)
        const healthScore = this.calculateHealthScore({
            income,
            balance,
            variableIncomePercent: this.percentage(variableTotal, income),
            creditExpensePercent,
            needsPercent: rule503020.needs.actualPercent,
            wantsPercent: rule503020.wants.actualPercent,
            futurePercent: rule503020.future.actualPercent,
        })
        const insights = this.buildInsights({
            income,
            variableTotal,
            variableTopCategory,
            cardDominant,
            creditExpensePercent,
            creditCardTopCategory,
            balance,
            foodDeliveryTotal: this.getCategoryTotal(variableCategoryGroups, 'Delivery'),
        })

        return {
            month,
            income,
            expenses,
            balance,
            commitmentRate,
            fixedExpenses: {
                total: fixedTotal,
                incomePercent: this.percentage(fixedTotal, income),
            },
            variableExpenses: {
                total: variableTotal,
                incomePercent: this.percentage(variableTotal, income),
                topCategory: variableTopCategory,
            },
            creditCardAnalysis: {
                total: creditCardTotal,
                expensePercent: creditExpensePercent,
                variablePercent: creditVariablePercent,
                topCategory: creditCardTopCategory,
                isDominant: cardDominant,
            },
            majorOffender,
            topOffenders,
            rule503020,
            healthScore,
            insights,
        }
    }

    private parseMonthRange(month: string) {
        const [yearRaw, monthRaw] = month.split('-')
        const year = Number(yearRaw)
        const monthIndex = Number(monthRaw) - 1

        const start = new Date(year, monthIndex, 1)
        const end = new Date(year, monthIndex + 1, 1)

        return { start, end }
    }

    private computeIncome(transactions: DashboardTransaction[]): number {
        const incomeValues = transactions
            .filter((transaction) => transaction.type === 'DEPOSIT' && !transaction.creditCardId)
            .map((transaction) => Number(transaction.amount || 0))

        return MoneyUtils.sum(incomeValues)
    }

    private buildExpenseEntries(
        transactions: DashboardTransaction[],
        categoryNameById: Map<string, string>,
    ): RawExpenseEntry[] {
        const entries: RawExpenseEntry[] = []

        for (const transaction of transactions) {
            let amount = 0
            if (transaction.type === 'EXPENSE') {
                amount = Number(transaction.amount || 0)
            } else if (transaction.type === 'DEPOSIT' && transaction.creditCardId) {
                amount = -Number(transaction.amount || 0)
            }

            if (MoneyUtils.isZero(amount)) continue

            const isCustomCategory = Boolean(transaction.categoryId)
            const category = transaction.categoryId
                ? categoryNameById.get(transaction.categoryId) || 'Categoria custom'
                : CATEGORY_LABELS[transaction.category] || 'Outros'

            entries.push({
                amount: MoneyUtils.round(amount),
                category,
                enumCategory: transaction.category,
                isCustomCategory,
                isRecurring: transaction.isRecurring,
                paymentMethod: transaction.paymentMethod,
                isCreditCard: transaction.paymentMethod === 'CREDIT_CARD',
            })
        }

        return entries
    }

    private isFixedExpense(entry: RawExpenseEntry): boolean {
        if (entry.isRecurring) return true
        if (entry.isCustomCategory) return false
        return FIXED_ENUM_CATEGORIES.has(entry.enumCategory)
    }

    private groupByCategory(entries: RawExpenseEntry[]): Map<string, number> {
        const categoryTotals = new Map<string, number>()

        for (const entry of entries) {
            const current = categoryTotals.get(entry.category) || 0
            categoryTotals.set(entry.category, MoneyUtils.add(current, entry.amount))
        }

        return categoryTotals
    }

    private groupByCategoryWithPaymentFocus(entries: RawExpenseEntry[]) {
        const grouped = new Map<string, { name: string; total: number; methods: Map<string, number> }>()

        for (const entry of entries) {
            if (!grouped.has(entry.category)) {
                grouped.set(entry.category, { name: entry.category, total: 0, methods: new Map() })
            }

            const row = grouped.get(entry.category)!
            row.total = MoneyUtils.add(row.total, entry.amount)

            const currentMethodTotal = row.methods.get(entry.paymentMethod) || 0
            row.methods.set(entry.paymentMethod, MoneyUtils.add(currentMethodTotal, entry.amount))
        }

        return grouped
    }

    private findTopCategory(categoryTotals: Map<string, number>, income: number): CategorySummary | null {
        const sorted = Array.from(categoryTotals.entries())
            .filter(([, total]) => total > 0)
            .sort((a, b) => b[1] - a[1])

        if (!sorted.length) return null

        const [category, total] = sorted[0]
        return {
            category,
            total: MoneyUtils.round(total),
            incomePercent: this.percentage(total, income),
        }
    }

    private resolvePaymentMethodFocus(methodTotals: Map<string, number>): PaymentMethodFocus {
        let creditTotal = 0
        let otherTotal = 0

        for (const [method, total] of methodTotals.entries()) {
            const positiveTotal = Math.max(total, 0)
            if (positiveTotal <= 0) continue

            if (method === 'CREDIT_CARD') {
                creditTotal = MoneyUtils.add(creditTotal, positiveTotal)
            } else {
                otherTotal = MoneyUtils.add(otherTotal, positiveTotal)
            }
        }

        if (creditTotal <= 0 && otherTotal <= 0) return 'other'
        if (creditTotal > 0 && otherTotal <= 0) return 'credit_card'

        const creditShare = this.percentage(creditTotal, MoneyUtils.add(creditTotal, otherTotal))
        if (creditShare >= 60) return 'credit_card'
        if (creditTotal > 0 && otherTotal > 0) return 'mixed'
        return 'other'
    }

    private resolveMajorOffender(input: {
        cardDominant: boolean
        variableTotal: number
        fixedTotal: number
        variableTopCategory: CategorySummary | null
        fixedTopCategory: CategorySummary | null
        creditCardTopCategory: CategorySummary | null
        variableCategoryGroups: Map<string, { name: string; total: number; methods: Map<string, number> }>
        fixedCategoryGroups: Map<string, { name: string; total: number; methods: Map<string, number> }>
        income: number
    }): MonthlySummaryOutput['majorOffender'] {
        if (input.cardDominant && input.creditCardTopCategory && input.variableTotal > 0) {
            return {
                category: input.creditCardTopCategory.category,
                total: input.creditCardTopCategory.total,
                incomePercent: input.creditCardTopCategory.incomePercent,
                origin: 'credit_card',
                paymentMethodFocus: 'credit_card',
            }
        }

        if (input.variableTotal >= input.fixedTotal && input.variableTopCategory) {
            const group = input.variableCategoryGroups.get(input.variableTopCategory.category)
            return {
                category: input.variableTopCategory.category,
                total: input.variableTopCategory.total,
                incomePercent: input.variableTopCategory.incomePercent,
                origin: 'variable',
                paymentMethodFocus: group ? this.resolvePaymentMethodFocus(group.methods) : 'other',
            }
        }

        if (input.fixedTopCategory) {
            const group = input.fixedCategoryGroups.get(input.fixedTopCategory.category)
            return {
                category: input.fixedTopCategory.category,
                total: input.fixedTopCategory.total,
                incomePercent: input.fixedTopCategory.incomePercent,
                origin: 'fixed',
                paymentMethodFocus: group ? this.resolvePaymentMethodFocus(group.methods) : 'other',
            }
        }

        return null
    }

    private calculateRule503020(
        expenseEntries: RawExpenseEntry[],
        income: number,
        balance: number,
    ): MonthlySummaryOutput['rule503020'] {
        let needs = 0
        let wants = 0

        for (const entry of expenseEntries) {
            if (this.bucketForRule(entry) === 'needs') {
                needs = MoneyUtils.add(needs, entry.amount)
                continue
            }

            wants = MoneyUtils.add(wants, entry.amount)
        }

        const needsTotal = this.clampMoney(needs)
        const wantsTotal = this.clampMoney(wants)
        const futureTotal = this.clampMoney(Math.max(balance, 0))

        const needsPercent = this.percentage(needsTotal, income)
        const wantsPercent = this.percentage(wantsTotal, income)
        const futurePercent = this.percentage(futureTotal, income)

        if (income <= 0) {
            return {
                needs: {
                    idealPercent: 50,
                    actualPercent: 0,
                    total: needsTotal,
                    status: 'bad',
                },
                wants: {
                    idealPercent: 30,
                    actualPercent: 0,
                    total: wantsTotal,
                    status: 'bad',
                },
                future: {
                    idealPercent: 20,
                    actualPercent: 0,
                    total: futureTotal,
                    status: 'bad',
                },
            }
        }

        return {
            needs: {
                idealPercent: 50,
                actualPercent: needsPercent,
                total: needsTotal,
                status: this.resolveUpperBoundStatus(needsPercent, 50, 60),
            },
            wants: {
                idealPercent: 30,
                actualPercent: wantsPercent,
                total: wantsTotal,
                status: this.resolveUpperBoundStatus(wantsPercent, 30, 40),
            },
            future: {
                idealPercent: 20,
                actualPercent: futurePercent,
                total: futureTotal,
                status: this.resolveLowerBoundStatus(futurePercent, 20, 10),
            },
        }
    }

    private bucketForRule(entry: RawExpenseEntry): 'needs' | 'wants' {
        if (entry.isCustomCategory) return 'wants'
        if (NEEDS_ENUM_CATEGORIES.has(entry.enumCategory)) return 'needs'
        if (WANTS_ENUM_CATEGORIES.has(entry.enumCategory)) return 'wants'
        return 'wants'
    }

    private calculateHealthScore(input: {
        income: number
        balance: number
        variableIncomePercent: number
        creditExpensePercent: number
        needsPercent: number
        wantsPercent: number
        futurePercent: number
    }): MonthlySummaryOutput['healthScore'] {
        if (input.income <= 0 && input.balance <= 0) {
            return { value: 0, status: 'risk' }
        }

        let score = 0

        const balancePercent = this.percentage(input.balance, input.income)
        if (balancePercent >= 20) score += 25
        else if (balancePercent >= 10) score += 18
        else if (balancePercent >= 0) score += 10

        if (input.needsPercent <= 50) score += 20
        else if (input.needsPercent <= 60) score += 12
        else score += 5

        if (input.wantsPercent <= 30) score += 20
        else if (input.wantsPercent <= 40) score += 12
        else score += 5

        if (input.variableIncomePercent <= 35) score += 15
        else if (input.variableIncomePercent <= 45) score += 10
        else score += 4

        if (input.creditExpensePercent <= 45) score += 10
        else if (input.creditExpensePercent <= 60) score += 6
        else score += 2

        if (input.futurePercent >= 20) score += 10
        else if (input.futurePercent >= 10) score += 6
        else score += 2

        const normalizedScore = Math.max(0, Math.min(100, Math.round(score)))
        return {
            value: normalizedScore,
            status: normalizedScore >= 80 ? 'healthy' : normalizedScore >= 60 ? 'attention' : 'risk',
        }
    }

    private buildInsights(input: {
        income: number
        variableTotal: number
        variableTopCategory: CategorySummary | null
        cardDominant: boolean
        creditExpensePercent: number
        creditCardTopCategory: { name: string; total: number } | null
        balance: number
        foodDeliveryTotal: number
    }): string[] {
        const insights: string[] = []
        const variableIncomePercent = this.percentage(input.variableTotal, input.income)

        if (variableIncomePercent > 35 && input.variableTopCategory) {
            insights.push(
                `Seus gastos variaveis estao em ${variableIncomePercent.toFixed(1)}% da renda. O maior ofensor foi ${input.variableTopCategory.category} (${input.variableTopCategory.total.toFixed(2)}).`,
            )
        }

        if (input.cardDominant) {
            const categoryName = input.creditCardTopCategory?.name || 'uma categoria variavel'
            insights.push(
                `O cartao concentrou ${input.creditExpensePercent.toFixed(1)}% das despesas. Comece o ajuste por ${categoryName}.`,
            )
        }

        const balancePercent = this.percentage(input.balance, input.income)
        if (input.income > 0 && balancePercent < 15) {
            insights.push('Sua sobra para o futuro esta abaixo de 15% da renda. Priorize cortes rapidos nas categorias variaveis.')
        }

        const deliveryIncomePercent = this.percentage(input.foodDeliveryTotal, input.income)
        if (input.foodDeliveryTotal > 0 && (deliveryIncomePercent >= 8 || this.percentage(input.foodDeliveryTotal, input.variableTotal) >= 20)) {
            insights.push('Delivery esta alto no mes e costuma ser o corte mais rapido para recuperar folga no caixa.')
        }

        if (!insights.length) {
            insights.push('Sua estrutura do mes esta equilibrada. Continue monitorando variavel e cartao para manter folga de caixa.')
        }

        return insights.slice(0, 3)
    }

    private getCategoryTotal(
        groupedCategories: Map<string, { name: string; total: number; methods: Map<string, number> }>,
        categoryName: string,
    ): number {
        const category = groupedCategories.get(categoryName)
        if (!category) return 0
        return this.clampMoney(category.total)
    }

    private clampMoney(value: number): number {
        return MoneyUtils.round(Math.max(0, value))
    }

    private percentage(value: number, total: number): number {
        if (total <= 0) return 0
        return Number(((value / total) * 100).toFixed(1))
    }

    private resolveUpperBoundStatus(actualPercent: number, ideal: number, warning: number): BucketStatus {
        if (actualPercent <= ideal) return 'good'
        if (actualPercent <= warning) return 'warning'
        return 'bad'
    }

    private resolveLowerBoundStatus(actualPercent: number, ideal: number, warning: number): BucketStatus {
        if (actualPercent >= ideal) return 'good'
        if (actualPercent >= warning) return 'warning'
        return 'bad'
    }
}
