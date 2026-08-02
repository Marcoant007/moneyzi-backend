import { describe, expect, it } from 'vitest'
import { getRecommendedCardCeiling } from '../deep-analysis-use-case/get-recommended-card-ceiling'

describe('getRecommendedCardCeiling', () => {
    it('usa 30% da renda quando é o menor teto', () => {
        // 30% da renda = 3000 | 60% do orçamento livre (10000-2000)*0.6 = 4800
        const ceiling = getRecommendedCardCeiling(10000, 2000)
        expect(ceiling).toBe(3000)
    })

    it('usa 60% do orçamento livre quando é o menor teto', () => {
        // 30% da renda = 1500 | 60% do orçamento livre (5000-4000)*0.6 = 600
        const ceiling = getRecommendedCardCeiling(5000, 4000)
        expect(ceiling).toBe(600)
    })

    it('nunca retorna valor negativo quando o essencial supera a renda', () => {
        const ceiling = getRecommendedCardCeiling(3000, 5000)
        expect(ceiling).toBe(0)
    })
})
