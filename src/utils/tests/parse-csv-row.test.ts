import { describe, it, expect } from 'vitest'
import { parseCsvRow } from '@/utils/parse-csv-row'

describe('parseCsvRow', () => {
  it('parses amount, date, name and enums correctly', () => {
    const row = {
      Descricao: 'Compra Supermercado',
      Valor: 'R$ 1.234,56',
      Data: '01/02/2025',
      Tipo: 'EXPENSE',
      Categoria: 'FOOD',
      Metodo: 'CREDIT_CARD',
      Empty: '   '
    }

    const headerMap = {
      Descricao: 'name',
      Valor: 'amount',
      Data: 'date',
      Tipo: 'type',
      Categoria: 'category',
      Metodo: 'paymentMethod'
    } as Record<string, any>

    const parsed = parseCsvRow(row, headerMap)

    expect(parsed.name).toBe('Compra Supermercado')
    expect(parsed.amount).toBeCloseTo(1234.56)
    expect(parsed.date).toBeInstanceOf(Date)
    expect(parsed.type).toBe('EXPENSE')
    expect(parsed.category).toBe('FOOD')
    expect(parsed.paymentMethod).toBe('CREDIT_CARD')
    expect((parsed as any).Empty).toBeUndefined()
  })

  it('resolves a real-world Portuguese category (e.g. Inter CSV) via the dictionary', () => {
    const row = {
      Descricao: 'Compra Supermercado',
      Valor: 'R$ 50,00',
      Data: '01/02/2025',
      Categoria: 'Supermercado',
    }

    const headerMap = {
      Descricao: 'name',
      Valor: 'amount',
      Data: 'date',
      Categoria: 'category',
    } as Record<string, any>

    const parsed = parseCsvRow(row, headerMap)

    expect(parsed.rawCategoryText).toBe('Supermercado')
    expect(parsed.category).toBe('FOOD')
    expect(parsed.categoryName).toBe('Alimentação')
  })

  it('keeps only rawCategoryText when the CSV category is not recognized', () => {
    const row = {
      Descricao: 'Loja XYZ',
      Valor: 'R$ 50,00',
      Data: '01/02/2025',
      Categoria: 'Categoria Desconhecida Que Ninguem Usa',
    }

    const headerMap = {
      Descricao: 'name',
      Valor: 'amount',
      Data: 'date',
      Categoria: 'category',
    } as Record<string, any>

    const parsed = parseCsvRow(row, headerMap)

    expect(parsed.rawCategoryText).toBe('Categoria Desconhecida Que Ninguem Usa')
    expect(parsed.category).toBeUndefined()
    expect(parsed.categoryName).toBeUndefined()
  })

  it('parses US-format amount and date (MM/DD/YYYY, "$" + comma thousands) when region is US', () => {
    const row = {
      Description: 'Grocery Store',
      Amount: '$1,234.56',
      Date: '03/15/2025', // March 15th in US format
    }

    const headerMap = {
      Description: 'name',
      Amount: 'amount',
      Date: 'date',
    } as Record<string, any>

    const parsed = parseCsvRow(row, headerMap, 'US')

    expect(parsed.name).toBe('Grocery Store')
    expect(parsed.amount).toBeCloseTo(1234.56)
    expect(parsed.date).toBeInstanceOf(Date)
    expect((parsed.date as Date).getUTCMonth()).toBe(2) // March = index 2
    expect((parsed.date as Date).getUTCDate()).toBe(15)
  })

  it('still parses BR-format when region is BR (default), even with a day > 12', () => {
    const row = {
      Descricao: 'Compra',
      Valor: 'R$ 1.234,56',
      Data: '15/03/2025', // 15 de março em formato BR
    }

    const headerMap = {
      Descricao: 'name',
      Valor: 'amount',
      Data: 'date',
    } as Record<string, any>

    const parsed = parseCsvRow(row, headerMap, 'BR')

    expect(parsed.amount).toBeCloseTo(1234.56)
    expect((parsed.date as Date).getUTCMonth()).toBe(2) // março = index 2
    expect((parsed.date as Date).getUTCDate()).toBe(15)
  })
})
