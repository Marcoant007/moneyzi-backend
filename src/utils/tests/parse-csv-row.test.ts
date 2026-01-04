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
})
