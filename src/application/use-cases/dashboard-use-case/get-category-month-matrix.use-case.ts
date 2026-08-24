import type { TransactionRepository } from '@/application/repositories/transaction-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { Category } from '@prisma/client'
import { startOfMonth, endOfMonth, format } from 'date-fns'
import {
    buildCategoryTree,
    flattenCategoryTree,
    getAncestorIds,
    rollupCategoryTotals,
} from '@/utils/category-hierarchy'

export interface MatrixRow {
    id: string
    name: string
    depth: 1 | 2 | 3
    isLegacy?: boolean
    monthlyTotals: number[]
}

export interface CategoryMonthMatrixOutput {
    months: string[]
    income: { rows: MatrixRow[]; subtotal: number[] }
    expense: { rows: MatrixRow[]; subtotal: number[] }
    balance: number[]
}

const LEGACY_EXPENSE_ID = 'legacy-expense'
const LEGACY_INCOME_ID = 'legacy-income'

export class GetCategoryMonthMatrixUseCase {
    constructor(
        private transactionRepository: TransactionRepository,
        private categoryRepository: CategoryRepository
    ) { }

    async execute(input: { userId: string; year: number }): Promise<CategoryMonthMatrixOutput> {
        const { userId, year } = input

        const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(year, i, 1)
            return { start: startOfMonth(d), end: endOfMonth(d), label: format(d, 'yyyy-MM') }
        })

        const [monthlyGroups, categories] = await Promise.all([
            Promise.all(
                months.map((m) =>
                    this.transactionRepository.groupTransactionsByCategoryId(userId, { start: m.start, end: m.end })
                )
            ),
            this.categoryRepository.listByUserId(userId),
        ])

        const validCategoryIds = new Set(categories.map((c) => c.id))

        const expenseDirect: Map<string, number>[] = []
        const incomeDirect: Map<string, number>[] = []
        const legacyExpenseTotal = new Array(12).fill(0) as number[]
        const legacyIncomeTotal = new Array(12).fill(0) as number[]

        for (let i = 0; i < 12; i++) {
            const expenseMap = new Map<string, number>()
            const incomeMap = new Map<string, number>()

            for (const row of monthlyGroups[i]) {
                const amount = Number(row._sum.amount || 0)
                if (amount === 0) continue

                const hasValidCategory = !!row.categoryId && validCategoryIds.has(row.categoryId)

                if (row.type === 'EXPENSE') {
                    if (hasValidCategory) {
                        const id = row.categoryId as string
                        expenseMap.set(id, (expenseMap.get(id) ?? 0) + amount)
                    } else {
                        legacyExpenseTotal[i] += amount
                    }
                } else {
                    // DEPOSIT ou INVESTMENT entram juntos em Receitas
                    if (hasValidCategory) {
                        const id = row.categoryId as string
                        incomeMap.set(id, (incomeMap.get(id) ?? 0) + amount)
                    } else {
                        legacyIncomeTotal[i] += amount
                    }
                }
            }

            expenseDirect.push(expenseMap)
            incomeDirect.push(incomeMap)
        }

        const expenseRolledUp = expenseDirect.map((direct) => rollupCategoryTotals(categories, direct))
        const incomeRolledUp = incomeDirect.map((direct) => rollupCategoryTotals(categories, direct))

        const expenseSection = this.buildSection(categories, expenseDirect, expenseRolledUp, legacyExpenseTotal, LEGACY_EXPENSE_ID)
        const incomeSection = this.buildSection(categories, incomeDirect, incomeRolledUp, legacyIncomeTotal, LEGACY_INCOME_ID)

        const balance = Array.from({ length: 12 }, (_, i) => incomeSection.subtotal[i] - expenseSection.subtotal[i])

        return {
            months: months.map((m) => m.label),
            income: incomeSection,
            expense: expenseSection,
            balance,
        }
    }

    private buildSection(
        categories: Category[],
        direct: Map<string, number>[],
        rolledUp: Map<string, number>[],
        legacyTotal: number[],
        legacyId: string
    ): { rows: MatrixRow[]; subtotal: number[] } {
        const yearlyRolledUp = (id: string) => rolledUp.reduce((sum, monthMap) => sum + (monthMap.get(id) ?? 0), 0)
        const yearlyDirect = (id: string) => direct.reduce((sum, monthMap) => sum + (monthMap.get(id) ?? 0), 0)

        const tree = buildCategoryTree(categories)
        const topLevel = tree
            .filter((node) => yearlyRolledUp(node.id) > 0)
            .sort((a, b) => yearlyRolledUp(b.id) - yearlyRolledUp(a.id) || a.name.localeCompare(b.name))

        const rows: MatrixRow[] = []

        for (const topNode of topLevel) {
            rows.push({
                id: topNode.id,
                name: topNode.name,
                depth: 1,
                monthlyTotals: rolledUp.map((monthMap) => monthMap.get(topNode.id) ?? 0),
            })

            // Um descendente entra se tiver valor próprio, OU se for ancestral
            // (até o topNode) de um descendente que tem — senão uma
            // subcategoria com filho qualificado mas sem valor próprio
            // sumiria da lista, quebrando a reconstrução da árvore no
            // frontend (que espera pai sempre presente antes do filho).
            const allDescendants = flattenCategoryTree(topNode.children)
            const includedIds = new Set<string>()
            for (const node of allDescendants) {
                if (yearlyDirect(node.id) > 0) {
                    includedIds.add(node.id)
                    for (const ancestorId of getAncestorIds(categories, node.id)) {
                        if (ancestorId !== topNode.id) includedIds.add(ancestorId)
                    }
                }
            }

            for (const node of allDescendants) {
                if (!includedIds.has(node.id)) continue
                rows.push({
                    id: node.id,
                    name: node.name,
                    depth: node.depth as 1 | 2 | 3,
                    monthlyTotals: direct.map((monthMap) => monthMap.get(node.id) ?? 0),
                })
            }
        }

        const subtotal = new Array(12).fill(0) as number[]
        for (const row of rows) {
            if (row.depth === 1) {
                for (let i = 0; i < 12; i++) subtotal[i] += row.monthlyTotals[i]
            }
        }

        const legacyYearTotal = legacyTotal.reduce((sum, v) => sum + v, 0)
        if (legacyYearTotal > 0) {
            rows.push({ id: legacyId, name: '', depth: 1, isLegacy: true, monthlyTotals: legacyTotal })
            for (let i = 0; i < 12; i++) subtotal[i] += legacyTotal[i]
        }

        return { rows, subtotal }
    }
}
