import { prisma } from '@/lib/prisma'
import {
    CategoryRepository,
    CategoryTransactionRef,
    CreateCategoryData,
    RestoreCategoryData,
    UpdateCategoryData,
} from '@/application/repositories/category-repository'
import { Category, Prisma } from '@prisma/client'

// Postgres limita os parâmetros de bind por query; listas de ids grandes são
// quebradas em lotes (uma categoria com dezenas de milhares de transações é
// improvável, mas o merge/rollback não pode falhar por isso).
const ID_CHUNK_SIZE = 5000

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size))
    }
    return chunks
}

/**
 * Sem argumento usa o cliente global (comportamento de sempre). A
 * CategoryUnitOfWork passa o cliente de uma transação interativa pra que
 * leituras e escritas de uma reorganização compartilhem a mesma transação.
 */
export class PrismaCategoryRepository implements CategoryRepository {
    constructor(private readonly client: Prisma.TransactionClient = prisma) { }

    async create(data: CreateCategoryData): Promise<Category> {
        return this.client.category.create({
            data
        })
    }

    async findById(id: string): Promise<Category | null> {
        return this.client.category.findUnique({
            where: { id }
        })
    }

    async listByUserId(userId: string): Promise<Category[]> {
        return this.client.category.findMany({
            where: { userId },
            orderBy: { name: 'asc' }
        })
    }

    async update(id: string, data: UpdateCategoryData): Promise<Category> {
        return this.client.category.update({
            where: { id },
            data
        })
    }

    async delete(id: string): Promise<void> {
        await this.client.category.delete({
            where: { id }
        })
    }

    async existsByName(userId: string, name: string, parentId: string | null): Promise<boolean> {
        const category = await this.client.category.findFirst({
            where: {
                userId,
                parentId,
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        })
        return !!category
    }

    async findByNameAndParent(userId: string, name: string, parentId: string | null): Promise<Category | null> {
        return this.client.category.findFirst({
            where: {
                userId,
                parentId,
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        })
    }

    async hasTransactions(id: string): Promise<boolean> {
        const count = await this.client.transaction.count({
            where: {
                categoryId: id
            }
        })
        return count > 0
    }

    async hasChildren(id: string): Promise<boolean> {
        const count = await this.client.category.count({
            where: {
                parentId: id
            }
        })
        return count > 0
    }

    async hasGrandchildren(id: string): Promise<boolean> {
        const count = await this.client.category.count({
            where: {
                parent: {
                    parentId: id
                }
            }
        })
        return count > 0
    }

    async countTransactionsByCategoryId(userId: string): Promise<Map<string, number>> {
        const groups = await this.client.transaction.groupBy({
            by: ['categoryId'],
            where: { userId, categoryId: { not: null }, deletedAt: null },
            _count: { _all: true },
        })

        return new Map(groups.filter((g) => g.categoryId).map((g) => [g.categoryId as string, g._count._all]))
    }

    async countLinkedTransactionsByCategoryId(userId: string): Promise<Map<string, number>> {
        const groups = await this.client.transaction.groupBy({
            by: ['categoryId'],
            where: { userId, categoryId: { not: null } },
            _count: { _all: true },
        })

        return new Map(groups.filter((g) => g.categoryId).map((g) => [g.categoryId as string, g._count._all]))
    }

    async listTransactionRefs(userId: string, categoryId: string): Promise<CategoryTransactionRef[]> {
        // Sem filtro de deletedAt de propósito: o FK Transaction.categoryId é
        // ON DELETE SET NULL, então apagar a categoria zeraria as soft-deleted
        // também. Quem usa esta lista precisa enxergar todas.
        const rows = await this.client.transaction.findMany({
            where: { userId, categoryId },
            select: { id: true, deletedAt: true },
        })

        return rows.map((row) => ({ id: row.id, deleted: row.deletedAt !== null }))
    }

    async findTransactionCategoryIds(userId: string, transactionIds: string[]): Promise<Array<{ id: string; categoryId: string | null }>> {
        const results: Array<{ id: string; categoryId: string | null }> = []

        for (const ids of chunk(transactionIds, ID_CHUNK_SIZE)) {
            const rows = await this.client.transaction.findMany({
                where: { userId, id: { in: ids } },
                select: { id: true, categoryId: true },
            })
            results.push(...rows)
        }

        return results
    }

    async moveTransactionsToCategory(userId: string, fromCategoryId: string, toCategoryId: string): Promise<number> {
        const result = await this.client.transaction.updateMany({
            where: { userId, categoryId: fromCategoryId },
            data: { categoryId: toCategoryId },
        })
        return result.count
    }

    async assignTransactionsToCategory(userId: string, transactionIds: string[], categoryId: string): Promise<number> {
        let updated = 0

        for (const ids of chunk(transactionIds, ID_CHUNK_SIZE)) {
            const result = await this.client.transaction.updateMany({
                where: { userId, id: { in: ids } },
                data: { categoryId },
            })
            updated += result.count
        }

        return updated
    }

    async reparentCategories(userId: string, categoryIds: string[], parentId: string | null): Promise<number> {
        if (categoryIds.length === 0) return 0

        const result = await this.client.category.updateMany({
            where: { userId, id: { in: categoryIds } },
            data: { parentId },
        })
        return result.count
    }

    async restore(data: RestoreCategoryData): Promise<Category> {
        return this.client.category.create({
            data: {
                id: data.id,
                userId: data.userId,
                name: data.name,
                parentId: data.parentId,
                createdAt: data.createdAt,
                color: data.color ?? null,
                icon: data.icon ?? null,
            },
        })
    }

    async deleteForUser(userId: string, id: string): Promise<boolean> {
        const result = await this.client.category.deleteMany({
            where: { id, userId },
        })
        return result.count > 0
    }
}
