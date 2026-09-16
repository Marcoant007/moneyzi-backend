import { describe, it, expect, vi } from 'vitest'
import { CreateCategoryForMcpUseCase } from '../create-category-for-mcp.use-case'
import { CreateCategoryUseCase } from '@/application/use-cases/category-use-case/create-category.use-case'

function buildDeps() {
    const categoryRepository = {
        findByNameAndParent: vi.fn(),
        findById: vi.fn(),
        existsByName: vi.fn(),
        create: vi.fn(),
    } as any
    const mcpAuditLogRepository = { create: vi.fn() } as any
    const createCategoryUseCase = new CreateCategoryUseCase(categoryRepository)
    return { categoryRepository, mcpAuditLogRepository, createCategoryUseCase }
}

describe('CreateCategoryForMcpUseCase', () => {
    it('returns the existing category instead of creating a duplicate, and writes no audit log', async () => {
        const { categoryRepository, mcpAuditLogRepository, createCategoryUseCase } = buildDeps()
        const existing = { id: 'cat-1', name: 'Alimentação', parentId: null, createdAt: new Date('2026-01-01') }
        categoryRepository.findByNameAndParent.mockResolvedValue(existing)

        const useCase = new CreateCategoryForMcpUseCase(categoryRepository, createCategoryUseCase, mcpAuditLogRepository)
        const result = await useCase.execute({ userId: 'user-1', name: '  Alimentação  ' })

        expect(categoryRepository.findByNameAndParent).toHaveBeenCalledWith('user-1', 'Alimentação', null)
        expect(categoryRepository.create).not.toHaveBeenCalled()
        expect(mcpAuditLogRepository.create).not.toHaveBeenCalled()
        expect(result).toEqual({
            id: 'cat-1', name: 'Alimentação', parentId: null, createdAt: existing.createdAt,
            alreadyExisted: true, operationId: null,
        })
    })

    it('creates a new category and writes an audit log with previousState null', async () => {
        const { categoryRepository, mcpAuditLogRepository, createCategoryUseCase } = buildDeps()
        categoryRepository.findByNameAndParent.mockResolvedValue(null)
        const created = { id: 'cat-2', name: 'Transporte', parentId: null, createdAt: new Date('2026-01-02') }
        categoryRepository.create.mockResolvedValue(created)
        mcpAuditLogRepository.create.mockResolvedValue({ id: 'audit-1' })

        const useCase = new CreateCategoryForMcpUseCase(categoryRepository, createCategoryUseCase, mcpAuditLogRepository)
        const result = await useCase.execute({ userId: 'user-1', name: 'Transporte' })

        expect(mcpAuditLogRepository.create).toHaveBeenCalledWith({
            userId: 'user-1',
            tool: 'create_category',
            params: { name: 'Transporte', parentId: null },
            previousState: null,
            newState: { id: 'cat-2', name: 'Transporte', parentId: null },
        })
        expect(result.alreadyExisted).toBe(false)
        expect(result.operationId).toBe('audit-1')
    })
})
