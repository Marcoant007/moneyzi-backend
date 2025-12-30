import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreateCategoryUseCase } from './create-category.use-case'
import { CategoryRepository } from '@/application/repositories/category-repository'

describe('CreateCategoryUseCase', () => {
    let categoryRepository: CategoryRepository
    let sut: CreateCategoryUseCase

    beforeEach(() => {
        categoryRepository = {
            create: vi.fn(),
            findById: vi.fn(),
            listByUserId: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            existsByName: vi.fn(),
            hasTransactions: vi.fn(),
        } as unknown as CategoryRepository

        sut = new CreateCategoryUseCase(categoryRepository)
    })

    it('should be able to create a new category', async () => {
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.create).mockResolvedValue({
            id: 'category-1',
            name: 'New Category',
            userId: 'user-1',
            createdAt: new Date(),
            updatedAt: new Date(),
        })

        const result = await sut.execute({
            name: 'New Category',
            userId: 'user-1',
        })

        expect(result.id).toBe('category-1')
        expect(result.name).toBe('New Category')
        expect(categoryRepository.create).toHaveBeenCalledWith({
            name: 'New Category',
            userId: 'user-1',
        })
    })

    it('should not be able to create a new category with same name', async () => {
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(true)

        await expect(sut.execute({
            name: 'Existing Category',
            userId: 'user-1',
        })).rejects.toThrow('Category already exists')
    })
})
