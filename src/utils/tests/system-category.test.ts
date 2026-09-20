import { describe, it, expect } from 'vitest'
import { TransactionCategory } from '@prisma/client'
import {
    SYSTEM_CATEGORIES,
    assertNotSystemCategoryId,
    isSystemCategoryId,
    parseSystemCategoryId,
    toSystemCategoryId,
} from '../system-category'

describe('system category ids', () => {
    it('round-trips every TransactionCategory enum value', () => {
        expect(SYSTEM_CATEGORIES.length).toBe(Object.values(TransactionCategory).length)
        for (const category of SYSTEM_CATEGORIES) {
            expect(parseSystemCategoryId(toSystemCategoryId(category))).toBe(category)
        }
    })

    it('uses a stable, readable id', () => {
        expect(toSystemCategoryId('SERVICES')).toBe('system:SERVICES')
        expect(parseSystemCategoryId('system:SALARY')).toBe('SALARY')
    })

    it('never parses a real category uuid or an unknown enum', () => {
        expect(parseSystemCategoryId('7b5a5b1e-6f0c-4b9e-9d63-0b8f6f0c1a11')).toBeNull()
        expect(parseSystemCategoryId('system:NOT_A_CATEGORY')).toBeNull()
        expect(parseSystemCategoryId('SERVICES')).toBeNull()
        expect(parseSystemCategoryId('system:')).toBeNull()
    })

    it('flags anything with the prefix as a system id, even with an invalid enum', () => {
        expect(isSystemCategoryId('system:SERVICES')).toBe(true)
        expect(isSystemCategoryId('system:NOPE')).toBe(true)
        expect(isSystemCategoryId('cat-1')).toBe(false)
    })

    it('assertNotSystemCategoryId explains what to do instead', () => {
        expect(() => assertNotSystemCategoryId('system:HOUSING', 'apagada')).toThrow(/SYSTEM_CATEGORY.*não pode ser apagada.*list_categories/)
        expect(() => assertNotSystemCategoryId('cat-1', 'apagada')).not.toThrow()
    })
})
