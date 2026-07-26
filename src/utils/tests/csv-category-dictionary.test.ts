import { describe, it, expect } from 'vitest'
import { resolveCategoryFromText } from '@/utils/csv-category-dictionary'

describe('resolveCategoryFromText', () => {
  it('resolves known synonyms regardless of case and accents', () => {
    expect(resolveCategoryFromText('Supermercado')).toEqual({ category: 'FOOD', categoryName: 'Alimentação' })
    expect(resolveCategoryFromText('SUPERMERCADO')).toEqual({ category: 'FOOD', categoryName: 'Alimentação' })
    expect(resolveCategoryFromText('  supermercado  ')).toEqual({ category: 'FOOD', categoryName: 'Alimentação' })
    expect(resolveCategoryFromText('Educação')).toEqual({ category: 'EDUCATION', categoryName: 'Educação' })
    expect(resolveCategoryFromText('educacao')).toEqual({ category: 'EDUCATION', categoryName: 'Educação' })
  })

  it('resolves common Inter-style categories', () => {
    expect(resolveCategoryFromText('Transporte')).toEqual({ category: 'TRANSPORTATION', categoryName: 'Transporte' })
    expect(resolveCategoryFromText('Lazer')).toEqual({ category: 'ENTERTAINMENT', categoryName: 'Entretenimento' })
    expect(resolveCategoryFromText('Saúde')).toEqual({ category: 'HEALTH', categoryName: 'Saúde' })
    expect(resolveCategoryFromText('Streaming')).toEqual({ category: 'STREAMING', categoryName: 'Streaming' })
  })

  it('returns undefined for unrecognized or empty text', () => {
    expect(resolveCategoryFromText('Categoria Bem Estranha Que Nao Existe')).toBeUndefined()
    expect(resolveCategoryFromText('')).toBeUndefined()
    expect(resolveCategoryFromText('   ')).toBeUndefined()
  })
})
