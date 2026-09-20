import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreateCategoryUseCase } from '../category-use-case/create-category.use-case'
import { CategoryRepository } from '@/application/repositories/category-repository'
import type { Category } from '@prisma/client'

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 'category-1',
        name: 'New Category',
        userId: 'user-1',
        parentId: null,
        color: null,
        icon: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }
}

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
            hasChildren: vi.fn(),
            hasGrandchildren: vi.fn(),
        } as unknown as CategoryRepository

        sut = new CreateCategoryUseCase(categoryRepository)
    })

    it('should be able to create a new category', async () => {
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.create).mockResolvedValue(makeCategory())

        const result = await sut.execute({
            name: 'New Category',
            userId: 'user-1',
        })

        expect(result.id).toBe('category-1')
        expect(result.name).toBe('New Category')
        expect(result.parentId).toBeNull()
        expect(categoryRepository.create).toHaveBeenCalledWith({
            name: 'New Category',
            userId: 'user-1',
        })
        expect(categoryRepository.existsByName).toHaveBeenCalledWith('user-1', 'New Category', null)
    })

    it('should not be able to create a new category with same name', async () => {
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(true)

        await expect(sut.execute({
            name: 'Existing Category',
            userId: 'user-1',
        })).rejects.toThrow('Category already exists')
    })

    it('should create a subcategory under a valid top-level parent', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(
            makeCategory({ id: 'parent-1', name: 'Alimentação', parentId: null }),
        )
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.create).mockResolvedValue(
            makeCategory({ id: 'child-1', name: 'Supermercado', parentId: 'parent-1' }),
        )

        const result = await sut.execute({
            name: 'Supermercado',
            userId: 'user-1',
            parentId: 'parent-1',
        })

        expect(result.parentId).toBe('parent-1')
        expect(categoryRepository.create).toHaveBeenCalledWith({
            name: 'Supermercado',
            userId: 'user-1',
            parentId: 'parent-1',
        })
        expect(categoryRepository.existsByName).toHaveBeenCalledWith('user-1', 'Supermercado', 'parent-1')
    })

    it('should reject when the parent category is not found', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(null)

        await expect(sut.execute({
            name: 'iFood',
            userId: 'user-1',
            parentId: 'ghost',
        })).rejects.toThrow('Categoria pai não encontrada')
    })

    it('should reject when the parent category belongs to another user', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(
            makeCategory({ id: 'parent-1', userId: 'other-user', parentId: null }),
        )

        await expect(sut.execute({
            name: 'iFood',
            userId: 'user-1',
            parentId: 'parent-1',
        })).rejects.toThrow('Categoria pai inválida')
    })

    it('should reject creating a 4th-level category (depth limit exceeded)', async () => {
        // parent-3 (depth 3) -> its parent parent-2 (depth 2) -> its parent parent-1 (depth 1)
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'parent-3') return makeCategory({ id: 'parent-3', parentId: 'parent-2' })
            if (id === 'parent-2') return makeCategory({ id: 'parent-2', parentId: 'parent-1' })
            return null
        })

        await expect(sut.execute({
            name: 'Nível 4',
            userId: 'user-1',
            parentId: 'parent-3',
        })).rejects.toThrow('Profundidade máxima de categorias excedida (máximo de 3 níveis).')
    })

    it('should persist and return color/icon when provided', async () => {
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.create).mockResolvedValue(makeCategory({ color: 'sky', icon: 'utensils' }))

        const result = await sut.execute({ name: 'Mercado', userId: 'user-1', color: 'sky', icon: 'utensils' })

        expect(categoryRepository.create).toHaveBeenCalledWith({ name: 'Mercado', userId: 'user-1', color: 'sky', icon: 'utensils' })
        expect(result).toMatchObject({ color: 'sky', icon: 'utensils' })
    })

    it('should return null color/icon for a category created without them', async () => {
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.create).mockResolvedValue(makeCategory())

        const result = await sut.execute({ name: 'Plain', userId: 'user-1' })

        expect(result).toMatchObject({ color: null, icon: null })
    })
})
