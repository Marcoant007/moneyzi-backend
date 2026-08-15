import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateCategoryUseCase } from '../category-use-case/update-category.use-case'
import { CategoryRepository } from '@/application/repositories/category-repository'
import type { Category } from '@prisma/client'

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 'category-1',
        name: 'Category',
        userId: 'user-1',
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }
}

describe('UpdateCategoryUseCase', () => {
    let categoryRepository: CategoryRepository
    let sut: UpdateCategoryUseCase

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

        sut = new UpdateCategoryUseCase(categoryRepository)
    })

    it('should rename without touching parentId when parentId is omitted', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(
            makeCategory({ id: 'cat-1', name: 'Old Name', parentId: 'parent-1' }),
        )
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.update).mockResolvedValue(
            makeCategory({ id: 'cat-1', name: 'New Name', parentId: 'parent-1' }),
        )

        const result = await sut.execute({ id: 'cat-1', userId: 'user-1', name: 'New Name' })

        expect(result.name).toBe('New Name')
        expect(categoryRepository.update).toHaveBeenCalledWith('cat-1', { name: 'New Name' })
        expect(categoryRepository.existsByName).toHaveBeenCalledWith('user-1', 'New Name', 'parent-1')
        expect(categoryRepository.hasChildren).not.toHaveBeenCalled()
    })

    it('should reparent to a valid new top-level parent and recompute depth', async () => {
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'cat-1') return makeCategory({ id: 'cat-1', name: 'Supermercado', parentId: 'old-parent' })
            if (id === 'new-parent') return makeCategory({ id: 'new-parent', name: 'Transporte', parentId: null })
            return null
        })
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(false)
        vi.mocked(categoryRepository.update).mockResolvedValue(
            makeCategory({ id: 'cat-1', name: 'Supermercado', parentId: 'new-parent' }),
        )

        const result = await sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Supermercado',
            parentId: 'new-parent',
        })

        expect(result.parentId).toBe('new-parent')
        expect(categoryRepository.update).toHaveBeenCalledWith('cat-1', {
            name: 'Supermercado',
            parentId: 'new-parent',
        })
    })

    it('should move a category to top-level when parentId is explicitly null', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(
            makeCategory({ id: 'cat-1', name: 'Supermercado', parentId: 'old-parent' }),
        )
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(false)
        vi.mocked(categoryRepository.update).mockResolvedValue(
            makeCategory({ id: 'cat-1', name: 'Supermercado', parentId: null }),
        )

        const result = await sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Supermercado',
            parentId: null,
        })

        expect(result.parentId).toBeNull()
        expect(categoryRepository.update).toHaveBeenCalledWith('cat-1', {
            name: 'Supermercado',
            parentId: null,
        })
    })

    it('should reject setting a category as its own parent', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(
            makeCategory({ id: 'cat-1', parentId: null }),
        )

        await expect(sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Category',
            parentId: 'cat-1',
        })).rejects.toThrow('Uma categoria não pode ser sua própria categoria pai.')
    })

    it('should reject moving a category into its own direct child (cycle)', async () => {
        // cat-1 (Alimentação, top) -> child-1 (Supermercado, child of cat-1)
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'cat-1') return makeCategory({ id: 'cat-1', name: 'Alimentação', parentId: null })
            if (id === 'child-1') return makeCategory({ id: 'child-1', name: 'Supermercado', parentId: 'cat-1' })
            return null
        })

        await expect(sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Alimentação',
            parentId: 'child-1',
        })).rejects.toThrow('Não é possível mover uma categoria para dentro de sua própria subcategoria.')
    })

    it('should reject moving a category into its own grandchild (cycle, 2 levels deep)', async () => {
        // cat-1 (top) -> child-1 (mid) -> grandchild-1 (leaf)
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'cat-1') return makeCategory({ id: 'cat-1', parentId: null })
            if (id === 'child-1') return makeCategory({ id: 'child-1', parentId: 'cat-1' })
            if (id === 'grandchild-1') return makeCategory({ id: 'grandchild-1', parentId: 'child-1' })
            return null
        })

        await expect(sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Category',
            parentId: 'grandchild-1',
        })).rejects.toThrow('Não é possível mover uma categoria para dentro de sua própria subcategoria.')
    })

    it('should reject reparenting under a category that is already at depth 3', async () => {
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'cat-1') return makeCategory({ id: 'cat-1', parentId: null })
            if (id === 'leaf-3') return makeCategory({ id: 'leaf-3', parentId: 'mid-2' })
            if (id === 'mid-2') return makeCategory({ id: 'mid-2', parentId: 'top-1' })
            if (id === 'top-1') return makeCategory({ id: 'top-1', parentId: null })
            return null
        })

        await expect(sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Category',
            parentId: 'leaf-3',
        })).rejects.toThrow('Profundidade máxima de categorias excedida (máximo de 3 níveis).')
    })

    it('should reject moving a category with grandchildren anywhere but top-level', async () => {
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'cat-1') return makeCategory({ id: 'cat-1', parentId: null })
            if (id === 'new-parent') return makeCategory({ id: 'new-parent', parentId: null })
            return null
        })
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(true)
        vi.mocked(categoryRepository.hasGrandchildren).mockResolvedValue(true)

        await expect(sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Category',
            parentId: 'new-parent',
        })).rejects.toThrow('Não é possível mover uma categoria com subcategorias para este nível: excederia a profundidade máxima de 3 níveis.')
    })

    it('should allow moving a category with only children (no grandchildren) one level deep', async () => {
        vi.mocked(categoryRepository.findById).mockImplementation(async (id: string) => {
            if (id === 'cat-1') return makeCategory({ id: 'cat-1', parentId: null })
            if (id === 'new-parent') return makeCategory({ id: 'new-parent', parentId: null })
            return null
        })
        vi.mocked(categoryRepository.existsByName).mockResolvedValue(false)
        vi.mocked(categoryRepository.hasChildren).mockResolvedValue(true)
        vi.mocked(categoryRepository.hasGrandchildren).mockResolvedValue(false)
        vi.mocked(categoryRepository.update).mockResolvedValue(
            makeCategory({ id: 'cat-1', parentId: 'new-parent' }),
        )

        const result = await sut.execute({
            id: 'cat-1',
            userId: 'user-1',
            name: 'Category',
            parentId: 'new-parent',
        })

        expect(result.parentId).toBe('new-parent')
    })

    it('should still throw Category not found / Unauthorized as before', async () => {
        vi.mocked(categoryRepository.findById).mockResolvedValue(null)
        await expect(sut.execute({ id: 'ghost', userId: 'user-1', name: 'X' })).rejects.toThrow('Category not found')

        vi.mocked(categoryRepository.findById).mockResolvedValue(makeCategory({ userId: 'other-user' }))
        await expect(sut.execute({ id: 'cat-1', userId: 'user-1', name: 'X' })).rejects.toThrow('Unauthorized')
    })
})
