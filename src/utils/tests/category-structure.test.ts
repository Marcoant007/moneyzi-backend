import { describe, it, expect } from 'vitest'
import {
    computeMergeFingerprint,
    findSiblingNameCollision,
    getSubtreeHeight,
    normalizeCategoryName,
    planMerge,
    planMove,
    type NamedCategoryNode,
} from '../category-structure'

function node(id: string, name: string, parentId: string | null = null): NamedCategoryNode {
    return { id, name, parentId }
}

describe('normalizeCategoryName', () => {
    it('ignores case and leading/trailing whitespace (legacy names like "Aluguel Base " exist)', () => {
        expect(normalizeCategoryName('Aluguel Base ')).toBe('aluguel base')
        expect(normalizeCategoryName('  fundo de reserva ')).toBe('fundo de reserva')
        expect(normalizeCategoryName('ALUGUEL BASE')).toBe(normalizeCategoryName('aluguel base '))
    })

    it('keeps inner spaces significant', () => {
        expect(normalizeCategoryName('a  b')).not.toBe(normalizeCategoryName('a b'))
    })
})

describe('getSubtreeHeight', () => {
    const tree = [node('a', 'A'), node('b', 'B', 'a'), node('c', 'C', 'b'), node('solo', 'Solo')]

    it('is 1 for a leaf, 2 with children, 3 with grandchildren', () => {
        expect(getSubtreeHeight(tree, 'solo')).toBe(1)
        expect(getSubtreeHeight(tree, 'c')).toBe(1)
        expect(getSubtreeHeight(tree, 'b')).toBe(2)
        expect(getSubtreeHeight(tree, 'a')).toBe(3)
    })

    it('does not loop forever on corrupted (cyclic) data', () => {
        const cyclic = [node('x', 'X', 'y'), node('y', 'Y', 'x')]
        expect(getSubtreeHeight(cyclic, 'x')).toBeGreaterThan(0)
    })
})

describe('findSiblingNameCollision', () => {
    const categories = [
        node('root1', 'Moradia'),
        node('root2', 'Aluguel Base '),
        node('child', 'Aluguel Base', 'root1'),
    ]

    it('matches case-insensitively and across trailing whitespace, only under the same parent', () => {
        expect(findSiblingNameCollision(categories, null, 'aluguel base')?.id).toBe('root2')
        expect(findSiblingNameCollision(categories, 'root1', 'ALUGUEL BASE ')?.id).toBe('child')
        expect(findSiblingNameCollision(categories, 'root2', 'Aluguel Base')).toBeUndefined()
    })

    it('can ignore the category being renamed/moved itself', () => {
        expect(findSiblingNameCollision(categories, null, 'Aluguel Base', ['root2'])).toBeUndefined()
    })
})

describe('planMove', () => {
    // Alimentação(1) -> Mercado(2) -> iFood(3) ; Lazer(1) ; Viagens(1) -> Hotéis(2)
    const categories = [
        node('food', 'Alimentação'),
        node('market', 'Mercado', 'food'),
        node('ifood', 'iFood', 'market'),
        node('fun', 'Lazer'),
        node('trips', 'Viagens'),
        node('hotels', 'Hotéis', 'trips'),
    ]

    it('is a no-op when the category is already under that parent', () => {
        expect(planMove(categories, 'market', 'food').isNoop).toBe(true)
        expect(planMove(categories, 'food', null).isNoop).toBe(true)
    })

    it('turns a category into a root with null', () => {
        const plan = planMove(categories, 'market', null)
        expect(plan.isNoop).toBe(false)
        expect(plan.newParent).toBeNull()
    })

    it('rejects moving a category into itself or into its own descendant (cycle)', () => {
        expect(() => planMove(categories, 'food', 'food')).toThrow(/CYCLE/)
        expect(() => planMove(categories, 'food', 'market')).toThrow(/CYCLE/)
        expect(() => planMove(categories, 'food', 'ifood')).toThrow(/CYCLE/)
    })

    it('counts the whole moved subtree against the 3-level limit', () => {
        // Mercado tem altura 2 (Mercado -> iFood). Sob Hotéis (nível 2) ficaria em 3+... = 4.
        expect(() => planMove(categories, 'market', 'hotels')).toThrow(/MAX_DEPTH_EXCEEDED/)
        // Sob Lazer (nível 1): Mercado em 2, iFood em 3 — cabe exatamente.
        expect(() => planMove(categories, 'market', 'fun')).not.toThrow()
        // Uma folha sob um nível-2 cabe (vira nível 3).
        expect(() => planMove(categories, 'fun', 'hotels')).not.toThrow()
        // Nada pode ficar embaixo de um nível 3.
        expect(() => planMove(categories, 'fun', 'ifood')).toThrow(/MAX_DEPTH_EXCEEDED/)
    })

    it('rejects a name collision under the new parent (case/whitespace-insensitive)', () => {
        const withClash = [...categories, node('clash', 'mercado ', 'fun')]
        expect(() => planMove(withClash, 'market', 'fun')).toThrow(/NAME_COLLISION/)
    })

    it('rejects a name collision with another root when moving to root', () => {
        const withClash = [...categories, node('rootMarket', 'MERCADO')]
        expect(() => planMove(withClash, 'market', null)).toThrow(/NAME_COLLISION/)
    })

    it('rejects unknown categories and unknown parents', () => {
        expect(() => planMove(categories, 'ghost', 'food')).toThrow('Categoria não encontrada')
        expect(() => planMove(categories, 'fun', 'ghost')).toThrow('Categoria pai não encontrada')
    })
})

describe('planMerge', () => {
    it('rejects source === target', () => {
        expect(() => planMerge([node('a', 'A')], 'a', 'a')).toThrow(/SAME_CATEGORY/)
    })

    it('rejects a missing source or target', () => {
        const categories = [node('a', 'A'), node('b', 'B')]
        expect(() => planMerge(categories, 'ghost', 'b')).toThrow('Categoria de origem não encontrada')
        expect(() => planMerge(categories, 'a', 'ghost')).toThrow('Categoria de destino não encontrada')
    })

    it('rejects a target that is a descendant of the source (would create a cycle)', () => {
        const categories = [node('a', 'A'), node('b', 'B', 'a'), node('c', 'C', 'b')]
        expect(() => planMerge(categories, 'a', 'b')).toThrow(/CYCLE/)
        expect(() => planMerge(categories, 'a', 'c')).toThrow(/CYCLE/)
    })

    it('allows merging a category into its own ancestor', () => {
        const categories = [node('a', 'A'), node('b', 'B', 'a')]
        const plan = planMerge(categories, 'b', 'a')
        expect(plan.conflicts).toEqual([])
    })

    it('lists the children that will be re-pointed', () => {
        const categories = [node('s', 'Origem'), node('t', 'Destino'), node('c1', 'Um', 's'), node('c2', 'Dois', 's')]
        const plan = planMerge(categories, 's', 't')
        expect(plan.childrenToReparent.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
        expect(plan.conflicts).toEqual([])
        expect(plan.depthViolations).toEqual([])
    })

    it('reports same-named children as conflicts (case- and trailing-space-insensitive) instead of resolving them', () => {
        const categories = [
            node('s', 'Origem'),
            node('t', 'Destino'),
            node('sc', 'fundo de reserva ', 's'),
            node('tc', 'Fundo de Reserva', 't'),
            node('other', 'Outra', 's'),
        ]
        const plan = planMerge(categories, 's', 't')

        expect(plan.conflicts).toEqual([
            {
                name: 'fundo de reserva',
                sourceChild: { id: 'sc', name: 'fundo de reserva ' },
                targetChild: { id: 'tc', name: 'Fundo de Reserva' },
            },
        ])
    })

    it('counts the source itself as a target child when the source lives under the target (children are re-pointed BEFORE the source is deleted)', () => {
        // origem "Casa" é filha do destino "Moradia" e tem uma filha também chamada "Casa":
        // ao reapontar a filha, a origem ainda existe — o banco veria 2 "Casa" sob "Moradia".
        const categories = [node('t', 'Moradia'), node('s', 'Casa', 't'), node('sc', 'Casa', 's')]
        expect(planMerge(categories, 's', 't').conflicts).toEqual([
            {
                name: 'Casa',
                sourceChild: { id: 'sc', name: 'Casa' },
                targetChild: { id: 's', name: 'Casa' },
                targetChildIsSource: true,
            },
        ])
    })

    it('has no conflict when the source under the target has differently-named children', () => {
        const categories = [node('t', 'Moradia'), node('s', 'Casa', 't'), node('sc', 'Reforma', 's')]
        expect(planMerge(categories, 's', 't').conflicts).toEqual([])
    })

    it('counts the whole re-pointed subtree against the 3-level limit', () => {
        // destino no nível 2; a filha da origem tem uma neta (altura 2) -> ficaria em 2+2 = 4
        const tooDeep = [
            node('rootT', 'RootT'),
            node('t', 'Destino', 'rootT'),
            node('s', 'Origem'),
            node('c', 'Filha', 's'),
            node('gc', 'Neta', 'c'),
        ]
        expect(planMerge(tooDeep, 's', 't').depthViolations).toEqual([{ id: 'c', name: 'Filha', resultingDepth: 4 }])

        // destino na raiz (nível 1): a mesma subárvore fica em 1+2 = 3 — cabe
        const fits = [node('t', 'Destino'), node('s', 'Origem'), node('c', 'Filha', 's'), node('gc', 'Neta', 'c')]
        expect(planMerge(fits, 's', 't').depthViolations).toEqual([])
    })
})

describe('computeMergeFingerprint', () => {
    it('does not depend on id order', () => {
        const a = computeMergeFingerprint({ transactionIds: ['t1', 't2', 't3'], childIds: ['c1', 'c2'] })
        const b = computeMergeFingerprint({ transactionIds: ['t3', 't1', 't2'], childIds: ['c2', 'c1'] })
        expect(a).toBe(b)
    })

    it('changes when a transaction or a child enters or leaves the set', () => {
        const base = computeMergeFingerprint({ transactionIds: ['t1', 't2'], childIds: ['c1'] })
        expect(computeMergeFingerprint({ transactionIds: ['t1', 't2', 't3'], childIds: ['c1'] })).not.toBe(base)
        expect(computeMergeFingerprint({ transactionIds: ['t1'], childIds: ['c1'] })).not.toBe(base)
        expect(computeMergeFingerprint({ transactionIds: ['t1', 't2'], childIds: ['c1', 'c2'] })).not.toBe(base)
        expect(computeMergeFingerprint({ transactionIds: ['t1', 't2'], childIds: [] })).not.toBe(base)
    })

    it('does not confuse a transaction id with a child id', () => {
        expect(computeMergeFingerprint({ transactionIds: ['x'], childIds: [] })).not.toBe(
            computeMergeFingerprint({ transactionIds: [], childIds: ['x'] }),
        )
    })
})
