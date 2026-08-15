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

export interface CategoryRepository {
    create(data: CreateCategoryData): Promise<Category>
    findById(id: string): Promise<Category | null>
    listByUserId(userId: string): Promise<Category[]>
    update(id: string, data: UpdateCategoryData): Promise<Category>
    delete(id: string): Promise<void>
    existsByName(userId: string, name: string, parentId: string | null): Promise<boolean>
    hasTransactions(id: string): Promise<boolean>
    hasChildren(id: string): Promise<boolean>
    hasGrandchildren(id: string): Promise<boolean>
}
