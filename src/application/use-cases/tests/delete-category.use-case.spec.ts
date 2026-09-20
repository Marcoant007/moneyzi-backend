import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeleteCategoryUseCase } from '../category-use-case/delete-category.use-case'
import { CategoryRepository } from '@/application/repositories/category-repository'
import type { Category } from '@prisma/client'

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 'category-1',
        name: 'Category',
        userId: 'user-1',
        parentId: null,
        color: null,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }
}

describe('DeleteCategoryUseCase', () => {
    let categoryRepository: CategoryRepository
    let sut: DeleteCategoryUseCase

    beforeEach(() => {
        categoryRepository = {
            create: vi.fn(),
            findById: vi.fn(),
            listByUserId: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            existsByName: vi.fn(),
            hasTransactions: vi.fn(),
            hasChildren: vi.fn(),
            hasGrandchildren: vi.fn(),
        } as unknown as CategoryRepository

        sut = new DeleteCategoryUseCase(categoryRepository)
    })

    it('should delete a category with no children and no transactions', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(makeCategory())
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(false)
        vi.mocked(categoryRepository.hasTransactions).mockResolvedValue(false)

        await sut.execute({ id: 'category-1', userId: 'user-1' })

        expect(categoryRepository.delete).toHaveBeenCalledWith('category-1')
    })

    it('should reject when the category has subcategories', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(makeCategory())
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(true)

        await expect(sut.execute({ id: 'category-1', userId: 'user-1' }))
            .rejects.toThrow('Category has children')

        expect(categoryRepository.delete).not.toHaveBeenCalled()
    })

    it('should reject when the category has transactions', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(makeCategory())
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(false)
        vi.mocked(categoryRepository.hasTransactions).mockResolvedValue(true)

        await expect(sut.execute({ id: 'category-1', userId: 'user-1' }))
            .rejects.toThrow('Category has transactions')

        expect(categoryRepository.delete).not.toHaveBeenCalled()
    })

    it('should check hasChildren before hasTransactions, and never call hasTransactions when it has children', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(makeCategory())
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(true)
        vi.mocked(categoryRepository.hasTransactions).mockResolvedValue(true)

        await expect(sut.execute({ id: 'category-1', userId: 'user-1' }))
            .rejects.toThrow('Category has children')

        expect(categoryRepository.hasTransactions).not.toHaveBeenCalled()
    })

    it('should reject when the category is not found', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(null)

        await expect(sut.execute({ id: 'ghost', userId: 'user-1' }))
            .rejects.toThrow('Category not found')
    })

    it('should reject when the category belongs to another user', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(makeCategory({ userId: 'other-user' }))

        await expect(sut.execute({ id: 'category-1', userId: 'user-1' }))
            .rejects.toThrow('Unauthorized')
    })
})
