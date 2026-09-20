import { describe, it, expect, vi } from 'vitest'
import { TransactionCategory } from '@prisma/client'
import { ListSystemCategoriesUseCase } from '../list-system-categories.use-case'

describe('ListSystemCategoriesUseCase', () => {
    it('exposes every system category with a stable id, isSystem:true and its transaction count (0 when none)', async () => {
        const transactionRepository = {
            countBySystemCategory: vi.fn().mockResolvedValue(new Map([['SERVICES', 3], ['OTHER', 12]])),
        } as any

        const result = await new ListSystemCategoriesUseCase(transactionRepository).execute('user-1')

        expect(transactionRepository.countBySystemCategory).toHaveBeenCalledWith('user-1')
        expect(result).toHaveLength(Object.values(TransactionCategory).length)
        expect(result.every((c) => c.isSystem === true && c.parentId === null)).toBe(true)

        expect(result.find((c) => c.name === 'SERVICES')).toEqual({ id: 'system:SERVICES', name: 'SERVICES', parentId: null, transactionCount: 3, isSystem: true })
        expect(result.find((c) => c.name === 'OTHER')!.transactionCount).toBe(12)
        expect(result.find((c) => c.name === 'HOUSING')).toMatchObject({ id: 'system:HOUSING', transactionCount: 0 })
    })

    it('ids are unique and never look like a category uuid', async () => {
        const transactionRepository = { countBySystemCategory: vi.fn().mockResolvedValue(new Map()) } as any

        const result = await new ListSystemCategoriesUseCase(transactionRepository).execute('user-1')

        expect(new Set(result.map((c) => c.id)).size).toBe(result.length)
        expect(result.every((c) => c.id.startsWith('system:'))).toBe(true)
    })
})
