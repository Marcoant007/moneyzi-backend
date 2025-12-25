import type { Category } from '@prisma/client'

export interface CreateCategoryData {
    name: string
    userId: string
}

export interface UpdateCategoryData {
    name?: string
}

export interface CategoryRepository {
    create(data: CreateCategoryData): Promise<Category>
    findById(id: string): Promise<Category | null>
    listByUserId(userId: string): Promise<Category[]>
    update(id: string, data: UpdateCategoryData): Promise<Category>
    delete(id: string): Promise<void>
    existsByName(userId: string, name: string): Promise<boolean>
    hasTransactions(id: string): Promise<boolean>
}
