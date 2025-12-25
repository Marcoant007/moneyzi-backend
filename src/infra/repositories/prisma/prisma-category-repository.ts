import { prisma } from '@/lib/prisma'
import { CategoryRepository, CreateCategoryData, UpdateCategoryData } from '@/application/repositories/category-repository'
import { Category } from '@prisma/client'

export class PrismaCategoryRepository implements CategoryRepository {
    async create(data: CreateCategoryData): Promise<Category> {
        return prisma.category.create({
            data
        })
    }

    async findById(id: string): Promise<Category | null> {
        return prisma.category.findUnique({
            where: { id }
        })
    }

    async listByUserId(userId: string): Promise<Category[]> {
        return prisma.category.findMany({
            where: { userId },
            orderBy: { name: 'asc' }
        })
    }

    async update(id: string, data: UpdateCategoryData): Promise<Category> {
        return prisma.category.update({
            where: { id },
            data
        })
    }

    async delete(id: string): Promise<void> {
        await prisma.category.delete({
            where: { id }
        })
    }

    async existsByName(userId: string, name: string): Promise<boolean> {
        const category = await prisma.category.findFirst({
            where: {
                userId,
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        })
        return !!category
    }

    async hasTransactions(id: string): Promise<boolean> {
        const count = await prisma.transaction.count({
            where: {
                categoryId: id
            }
        })
        return count > 0
    }
}
