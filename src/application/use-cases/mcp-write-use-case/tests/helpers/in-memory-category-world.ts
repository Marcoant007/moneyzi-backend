import type { Category, TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import type {
    CategoryRepository,
    CategoryTransactionRef,
    CreateCategoryData,
    RestoreCategoryData,
    UpdateCategoryData,
} from '@/application/repositories/category-repository'
import type { CategoryUnitOfWork, CategoryUnitOfWorkContext } from '@/application/repositories/category-unit-of-work'
import type {
    CreateMcpAuditLogData,
    McpAuditLogEntry,
    McpAuditLogRepository,
} from '@/application/repositories/mcp-audit-log-repository'
import type { McpTransactionFilter, McpTransactionSnapshot, TransactionRepository } from '@/application/repositories/transaction-repository'
import { SYSTEM_CATEGORIES } from '@/utils/system-category'

/**
 * "Banco" em memória pros testes de reorganização de categorias. Não é um mock
 * frouxo: reproduz o que o Postgres faria e que os testes precisam pegar —
 *  - FK ON DELETE SET NULL em Transaction.categoryId e Category.parentId (um
 *    delete feito na ordem errada orfana dados, como no banco de verdade);
 *  - unique [userId, parentId, name] (exata, e só com pai não nulo — NULL é
 *    distinto no Postgres, então raízes não são protegidas pelo banco);
 *  - id duplicado ao recriar categoria;
 *  - transação de banco (a UoW desfaz tudo se o trabalho lançar).
 */

export interface FakeTransaction {
    id: string
    userId: string
    name: string
    amount: number
    date: Date
    type: TransactionType
    paymentMethod: TransactionPaymentMethod
    category: TransactionCategory
    categoryId: string | null
    deletedAt: Date | null
}

export class InMemoryWorld {
    categories: Category[] = []
    transactions: FakeTransaction[] = []
    audits: McpAuditLogEntry[] = []
    private sequence = 0

    nextId(prefix: string): string {
        this.sequence += 1
        return `${prefix}-${this.sequence}`
    }

    addCategory(input: { id?: string; name: string; userId: string; parentId?: string | null; createdAt?: Date }): Category {
        const now = new Date('2026-01-01T00:00:00.000Z')
        const category: Category = {
            id: input.id ?? this.nextId('cat'),
            name: input.name,
            userId: input.userId,
            parentId: input.parentId ?? null,
            createdAt: input.createdAt ?? now,
            updatedAt: now,
        }
        this.categories.push(category)
        return category
    }

    addTransaction(input: Partial<FakeTransaction> & { userId: string }): FakeTransaction {
        const transaction: FakeTransaction = {
            id: input.id ?? this.nextId('tx'),
            userId: input.userId,
            name: input.name ?? 'Compra',
            amount: input.amount ?? 10,
            date: input.date ?? new Date('2026-03-10T12:00:00.000Z'),
            type: input.type ?? 'EXPENSE',
            paymentMethod: input.paymentMethod ?? 'PIX',
            category: input.category ?? 'OTHER',
            categoryId: input.categoryId ?? null,
            deletedAt: input.deletedAt ?? null,
        }
        this.transactions.push(transaction)
        return transaction
    }

    category(id: string): Category | undefined {
        return this.categories.find((c) => c.id === id)
    }

    transaction(id: string): FakeTransaction {
        const transaction = this.transactions.find((t) => t.id === id)
        if (!transaction) throw new Error(`fake transaction ${id} not found`)
        return transaction
    }

    snapshot() {
        return structuredClone({ categories: this.categories, transactions: this.transactions, audits: this.audits })
    }

    restore(state: ReturnType<InMemoryWorld['snapshot']>) {
        this.categories = state.categories
        this.transactions = state.transactions
        this.audits = state.audits
    }
}

export class InMemoryCategoryRepository implements CategoryRepository {
    constructor(private readonly world: InMemoryWorld) { }

    private assertUnique(candidate: { id: string; userId: string; parentId: string | null; name: string }) {
        if (candidate.parentId === null) return
        const clash = this.world.categories.some(
            (c) => c.id !== candidate.id && c.userId === candidate.userId && c.parentId === candidate.parentId && c.name === candidate.name,
        )
        if (clash) throw new Error('P2002: Unique constraint failed on (userId, parentId, name)')
    }

    async create(data: CreateCategoryData): Promise<Category> {
        const id = this.world.nextId('cat')
        this.assertUnique({ id, userId: data.userId, parentId: data.parentId ?? null, name: data.name })
        return this.world.addCategory({ id, name: data.name, userId: data.userId, parentId: data.parentId ?? null })
    }

    async findById(id: string): Promise<Category | null> {
        return this.world.category(id) ?? null
    }

    async listByUserId(userId: string): Promise<Category[]> {
        return this.world.categories
            .filter((c) => c.userId === userId)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => ({ ...c }))
    }

    async update(id: string, data: UpdateCategoryData): Promise<Category> {
        const category = this.world.category(id)
        if (!category) throw new Error('P2025: record to update not found')
        const next = {
            id,
            userId: category.userId,
            name: data.name ?? category.name,
            parentId: data.parentId !== undefined ? data.parentId : category.parentId,
        }
        this.assertUnique(next)
        Object.assign(category, { name: next.name, parentId: next.parentId })
        return { ...category }
    }

    async delete(id: string): Promise<void> {
        this.applyDelete(id)
    }

    async existsByName(userId: string, name: string, parentId: string | null): Promise<boolean> {
        return (await this.findByNameAndParent(userId, name, parentId)) !== null
    }

    async findByNameAndParent(userId: string, name: string, parentId: string | null): Promise<Category | null> {
        return (
            this.world.categories.find(
                (c) => c.userId === userId && c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase(),
            ) ?? null
        )
    }

    async hasTransactions(id: string): Promise<boolean> {
        return this.world.transactions.some((t) => t.categoryId === id)
    }

    async hasChildren(id: string): Promise<boolean> {
        return this.world.categories.some((c) => c.parentId === id)
    }

    async hasGrandchildren(id: string): Promise<boolean> {
        const childIds = this.world.categories.filter((c) => c.parentId === id).map((c) => c.id)
        return this.world.categories.some((c) => c.parentId !== null && childIds.includes(c.parentId))
    }

    async countTransactionsByCategoryId(userId: string): Promise<Map<string, number>> {
        const counts = new Map<string, number>()
        for (const t of this.world.transactions) {
            if (t.userId === userId && t.categoryId && t.deletedAt === null) {
                counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
            }
        }
        return counts
    }

    async listTransactionRefs(userId: string, categoryId: string): Promise<CategoryTransactionRef[]> {
        return this.world.transactions
            .filter((t) => t.userId === userId && t.categoryId === categoryId)
            .map((t) => ({ id: t.id, deleted: t.deletedAt !== null }))
    }

    async findTransactionCategoryIds(userId: string, transactionIds: string[]) {
        return this.world.transactions
            .filter((t) => t.userId === userId && transactionIds.includes(t.id))
            .map((t) => ({ id: t.id, categoryId: t.categoryId }))
    }

    async moveTransactionsToCategory(userId: string, fromCategoryId: string, toCategoryId: string): Promise<number> {
        let count = 0
        for (const t of this.world.transactions) {
            if (t.userId === userId && t.categoryId === fromCategoryId) {
                t.categoryId = toCategoryId
                count += 1
            }
        }
        return count
    }

    async assignTransactionsToCategory(userId: string, transactionIds: string[], categoryId: string): Promise<number> {
        let count = 0
        for (const t of this.world.transactions) {
            if (t.userId === userId && transactionIds.includes(t.id)) {
                t.categoryId = categoryId
                count += 1
            }
        }
        return count
    }

    async reparentCategories(userId: string, categoryIds: string[], parentId: string | null): Promise<number> {
        let count = 0
        for (const category of this.world.categories) {
            if (category.userId === userId && categoryIds.includes(category.id)) {
                this.assertUnique({ id: category.id, userId, parentId, name: category.name })
                category.parentId = parentId
                count += 1
            }
        }
        return count
    }

    async restore(data: RestoreCategoryData): Promise<Category> {
        if (this.world.category(data.id)) throw new Error('P2002: Unique constraint failed on (id)')
        this.assertUnique({ id: data.id, userId: data.userId, parentId: data.parentId, name: data.name })
        return this.world.addCategory({ id: data.id, name: data.name, userId: data.userId, parentId: data.parentId, createdAt: data.createdAt })
    }

    async deleteForUser(userId: string, id: string): Promise<boolean> {
        const category = this.world.category(id)
        if (!category || category.userId !== userId) return false
        this.applyDelete(id)
        return true
    }

    /** ON DELETE SET NULL nos dois FKs — exatamente o que o Postgres faz. */
    private applyDelete(id: string) {
        this.world.categories = this.world.categories.filter((c) => c.id !== id)
        for (const c of this.world.categories) {
            if (c.parentId === id) c.parentId = null
        }
        for (const t of this.world.transactions) {
            if (t.categoryId === id) t.categoryId = null
        }
    }
}

export class InMemoryAuditRepository implements McpAuditLogRepository {
    constructor(private readonly world: InMemoryWorld) { }

    async create(data: CreateMcpAuditLogData): Promise<McpAuditLogEntry> {
        const entry: McpAuditLogEntry = {
            id: this.world.nextId('op'),
            userId: data.userId,
            tool: data.tool,
            // JSON de verdade: o que volta do banco não carrega Date/undefined/instâncias.
            params: JSON.parse(JSON.stringify(data.params)),
            previousState: JSON.parse(JSON.stringify(data.previousState)),
            newState: JSON.parse(JSON.stringify(data.newState)),
            createdAt: new Date(),
            rolledBackAt: null,
        }
        this.world.audits.push(entry)
        return { ...entry }
    }

    async findByIdForUser(id: string, userId: string): Promise<McpAuditLogEntry | null> {
        const entry = this.world.audits.find((a) => a.id === id && a.userId === userId)
        return entry ? { ...entry } : null
    }

    async markRolledBack(id: string): Promise<void> {
        const entry = this.world.audits.find((a) => a.id === id)
        if (entry) entry.rolledBackAt = new Date()
    }
}

export class InMemoryCategoryUnitOfWork implements CategoryUnitOfWork {
    /** Quantas transações de banco foram abertas — os testes afirmam "uma só" pro merge. */
    runs = 0

    constructor(private readonly world: InMemoryWorld) { }

    async run<T>(work: (context: CategoryUnitOfWorkContext) => Promise<T>): Promise<T> {
        this.runs += 1
        const before = this.world.snapshot()
        try {
            return await work({
                categoryRepository: new InMemoryCategoryRepository(this.world),
                mcpAuditLogRepository: new InMemoryAuditRepository(this.world),
            })
        } catch (error) {
            this.world.restore(before)
            throw error
        }
    }
}

/** Só o que as tools MCP de categoria/transação usam — o resto da interface não é exercitado. */
export function createInMemoryTransactionRepository(world: InMemoryWorld): TransactionRepository {
    const snapshot = (t: FakeTransaction): McpTransactionSnapshot => ({
        id: t.id,
        name: t.name,
        amount: t.amount,
        date: t.date,
        categoryId: t.categoryId,
        category: t.category,
        categoryName: (t.categoryId && world.category(t.categoryId)?.name) || t.category,
    })

    const matches = (t: FakeTransaction, userId: string, filter: McpTransactionFilter): boolean => {
        if (t.userId !== userId || t.deletedAt !== null) return false
        if (filter.nameContains && !t.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false
        if (filter.nameContainsAny && !filter.nameContainsAny.some((term) => t.name.toLowerCase().includes(term.toLowerCase()))) return false
        if (filter.currentCategoryId && t.categoryId !== filter.currentCategoryId) return false
        if (filter.currentSystemCategory && !(t.categoryId === null && t.category === filter.currentSystemCategory)) return false
        if (filter.paymentMethod && t.paymentMethod !== filter.paymentMethod) return false
        if (filter.type && t.type !== filter.type) return false
        if (filter.amountMin !== undefined && t.amount < filter.amountMin) return false
        if (filter.amountMax !== undefined && t.amount > filter.amountMax) return false
        if (filter.dateFrom && t.date < filter.dateFrom) return false
        if (filter.dateTo && t.date > filter.dateTo) return false
        return true
    }

    const repository = {
        async findMany(userId: string, filters: { month: number; year: number }) {
            return world.transactions
                .filter((t) => t.userId === userId && t.deletedAt === null)
                .filter((t) => t.date.getUTCFullYear() === filters.year && t.date.getUTCMonth() + 1 === filters.month)
                .map((t) => ({
                    ...t,
                    categoryRef: t.categoryId ? { id: t.categoryId, name: world.category(t.categoryId)?.name ?? '' } : null,
                    account: null,
                }))
        },
        async findManyByFilter(userId: string, filter: McpTransactionFilter, limit: number) {
            return world.transactions
                .filter((t) => matches(t, userId, filter))
                .sort((a, b) => b.date.getTime() - a.date.getTime())
                .slice(0, limit)
                .map(snapshot)
        },
        async findManyByIdsWithCategory(ids: string[], userId: string) {
            return world.transactions
                .filter((t) => t.userId === userId && t.deletedAt === null && ids.includes(t.id))
                .map(snapshot)
        },
        async updateManyCategory(ids: string[], userId: string, data: { category?: TransactionCategory; categoryId?: string | null }) {
            let count = 0
            for (const t of world.transactions) {
                if (t.userId === userId && ids.includes(t.id)) {
                    if (data.categoryId !== undefined) t.categoryId = data.categoryId
                    if (data.category !== undefined) t.category = data.category
                    count += 1
                }
            }
            return count
        },
        async countBySystemCategory(userId: string) {
            const counts = new Map<TransactionCategory, number>()
            for (const t of world.transactions) {
                if (t.userId === userId && t.categoryId === null && t.deletedAt === null) {
                    counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
                }
            }
            return counts
        },
        async groupExpensesByCategoryId(userId: string) {
            const sums = new Map<string, number>()
            for (const t of world.transactions) {
                if (t.userId === userId && t.categoryId && t.type === 'EXPENSE' && t.deletedAt === null) {
                    sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount)
                }
            }
            return [...sums.entries()].map(([categoryId, amount]) => ({ categoryId, category: 'OTHER', _sum: { amount } }))
        },
    }

    return repository as unknown as TransactionRepository
}

export const ALL_SYSTEM_CATEGORY_COUNT = SYSTEM_CATEGORIES.length
