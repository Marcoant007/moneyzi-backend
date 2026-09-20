import type { Category } from '@prisma/client'

export interface CreateCategoryData {
    name: string
    userId: string
    parentId?: string | null
}

export interface UpdateCategoryData {
    name?: string
    parentId?: string | null
}

export interface RestoreCategoryData {
    id: string
    userId: string
    name: string
    parentId: string | null
    createdAt: Date
}

export interface CategoryTransactionRef {
    id: string
    /** Soft-delete (deletedAt preenchido). O FK é ON DELETE SET NULL: se a categoria for apagada, essas também perderiam o categoryId. */
    deleted: boolean
}

export interface CategoryRepository {
    create(data: CreateCategoryData): Promise<Category>
    findById(id: string): Promise<Category | null>
    listByUserId(userId: string): Promise<Category[]>
    update(id: string, data: UpdateCategoryData): Promise<Category>
    delete(id: string): Promise<void>
    existsByName(userId: string, name: string, parentId: string | null): Promise<boolean>
    findByNameAndParent(userId: string, name: string, parentId: string | null): Promise<Category | null>
    hasTransactions(id: string): Promise<boolean>
    hasChildren(id: string): Promise<boolean>
    hasGrandchildren(id: string): Promise<boolean>
    /** Contagem direta (não somada com descendentes) de transações por categoria, pra todas as categorias do usuário de uma vez. */
    countTransactionsByCategoryId(userId: string): Promise<Map<string, number>>

    // Reorganização de categorias (MCP). Todos escopados por userId e feitos pra
    // rodar dentro de uma CategoryUnitOfWork (o repositório então está ligado a
    // uma transação de banco).

    /** TODAS as transações que apontam pra categoria — inclusive soft-deleted, que hasTransactions também conta. */
    listTransactionRefs(userId: string, categoryId: string): Promise<CategoryTransactionRef[]>
    /** categoryId atual de cada transação pedida (as que não existem/não são do usuário não voltam). */
    findTransactionCategoryIds(userId: string, transactionIds: string[]): Promise<Array<{ id: string; categoryId: string | null }>>
    /** Aponta TODAS as transações de `fromCategoryId` pra `toCategoryId` (só o categoryId; o enum não muda). Retorna quantas mudaram. */
    moveTransactionsToCategory(userId: string, fromCategoryId: string, toCategoryId: string): Promise<number>
    /** Aponta só as transações listadas pra `categoryId` (usado no rollback, que restringe ao conjunto auditado). */
    assignTransactionsToCategory(userId: string, transactionIds: string[], categoryId: string): Promise<number>
    /** Troca o pai das categorias listadas (null = raiz). Retorna quantas mudaram. */
    reparentCategories(userId: string, categoryIds: string[], parentId: string | null): Promise<number>
    /** Recria uma categoria apagada preservando o id e o createdAt originais. */
    restore(data: RestoreCategoryData): Promise<Category>
    /** Apaga só se a categoria for do usuário. Retorna true se apagou. */
    deleteForUser(userId: string, id: string): Promise<boolean>
}
