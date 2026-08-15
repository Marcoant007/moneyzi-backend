import { describe, it, expect } from 'vitest'
import {
    getAncestorIds,
    getCategoryDepth,
    getTopLevelAncestorId,
    buildTopLevelCategoryNameMap,
    getDescendantIds,
    rollupCategoryTotals,
} from '../category-hierarchy'

const alimentacao = { id: 'alimentacao', parentId: null, name: 'Alimentação' }
const supermercado = { id: 'supermercado', parentId: 'alimentacao', name: 'Supermercado' }
const ifood = { id: 'ifood', parentId: 'supermercado', name: 'iFood' }
const transporte = { id: 'transporte', parentId: null, name: 'Transporte' }

const tree = [alimentacao, supermercado, ifood, transporte]

describe('category-hierarchy', () => {
    describe('empty/flat input', () => {
        it('handles an empty list', () => {
            expect(getAncestorIds([], 'ghost')).toEqual([])
            expect(getDescendantIds([], 'ghost')).toEqual(new Set())
            expect(rollupCategoryTotals([], new Map())).toEqual(new Map())
        })

        it('treats a flat (no-parent) category as depth 1 with no ancestors', () => {
            expect(getAncestorIds([transporte], 'transporte')).toEqual([])
            expect(getCategoryDepth([transporte], 'transporte')).toBe(1)
            expect(getTopLevelAncestorId([transporte], 'transporte')).toBe('transporte')
        })
    })

    describe('the user\'s own example: Alimentação -> Supermercado -> iFood', () => {
        it('computes depth correctly at each of the 3 levels', () => {
            expect(getCategoryDepth(tree, 'alimentacao')).toBe(1)
            expect(getCategoryDepth(tree, 'supermercado')).toBe(2)
            expect(getCategoryDepth(tree, 'ifood')).toBe(3)
        })

        it('computes ancestor ids bottom-up', () => {
            expect(getAncestorIds(tree, 'ifood')).toEqual(['supermercado', 'alimentacao'])
            expect(getAncestorIds(tree, 'supermercado')).toEqual(['alimentacao'])
            expect(getAncestorIds(tree, 'alimentacao')).toEqual([])
        })

        it('resolves the top-level ancestor id for every level', () => {
            expect(getTopLevelAncestorId(tree, 'ifood')).toBe('alimentacao')
            expect(getTopLevelAncestorId(tree, 'supermercado')).toBe('alimentacao')
            expect(getTopLevelAncestorId(tree, 'alimentacao')).toBe('alimentacao')
        })

        it('buildTopLevelCategoryNameMap resolves every id to the top-level name', () => {
            const map = buildTopLevelCategoryNameMap(tree)
            expect(map.get('ifood')).toBe('Alimentação')
            expect(map.get('supermercado')).toBe('Alimentação')
            expect(map.get('alimentacao')).toBe('Alimentação')
            expect(map.get('transporte')).toBe('Transporte')
        })

        it('getDescendantIds returns all descendants at every level down', () => {
            expect(getDescendantIds(tree, 'alimentacao')).toEqual(new Set(['supermercado', 'ifood']))
            expect(getDescendantIds(tree, 'supermercado')).toEqual(new Set(['ifood']))
            expect(getDescendantIds(tree, 'ifood')).toEqual(new Set())
        })

        it('rollupCategoryTotals sums bottom-up: 100/200/300 direct -> 600/500/300 rolled up', () => {
            const direct = new Map([
                ['alimentacao', 100],
                ['supermercado', 200],
                ['ifood', 300],
            ])
            const rolled = rollupCategoryTotals(tree, direct)
            expect(rolled.get('alimentacao')).toBe(600)
            expect(rolled.get('supermercado')).toBe(500)
            expect(rolled.get('ifood')).toBe(300)
        })
    })

    it('rollupCategoryTotals accumulates additively across multiple siblings under the same parent', () => {
        const parent = { id: 'parent', parentId: null, name: 'Parent' }
        const childA = { id: 'child-a', parentId: 'parent', name: 'A' }
        const childB = { id: 'child-b', parentId: 'parent', name: 'B' }
        const siblings = [parent, childA, childB]

        const direct = new Map([
            ['parent', 10],
            ['child-a', 20],
            ['child-b', 30],
        ])
        const rolled = rollupCategoryTotals(siblings, direct)

        expect(rolled.get('parent')).toBe(60) // 10 + 20 + 30
        expect(rolled.get('child-a')).toBe(20)
        expect(rolled.get('child-b')).toBe(30)
    })

    it('does not crash on a dangling parentId pointing to a non-existent category', () => {
        const orphan = { id: 'orphan', parentId: 'does-not-exist', name: 'Orphan' }
        expect(() => getCategoryDepth([orphan], 'orphan')).not.toThrow()
        expect(getAncestorIds([orphan], 'orphan')).toEqual(['does-not-exist'])
    })
})
