import { describe, it, expect } from 'vitest'
import { parseCsv } from '@/utils/parse-csv'

describe('parseCsv', () => {
  it('parses a simple CSV into parsed transactions', () => {
    const csv = `Descrição,Valor,Data\n"Padaria","R$ 5,00","01/01/2025"\n"Loja","R$ 10,50","2025-02-02"`

    const buffer = Buffer.from(csv, 'utf-8')

    const parsed = parseCsv(buffer)

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(2)
    expect(parsed[0].name).toBe('Padaria')
    expect(parsed[1].name).toBe('Loja')
  })

  it('parses a US-format CSV (English headers, MM/DD/YYYY, "$" amounts) when region is US', () => {
    const csv = `Description,Amount,Date\n"Coffee Shop","$4.50","03/15/2025"\n"Grocery Store","$1,234.56","12/25/2025"`

    const buffer = Buffer.from(csv, 'utf-8')

    const parsed = parseCsv(buffer, 'US')

    expect(parsed.length).toBe(2)
    expect(parsed[0].name).toBe('Coffee Shop')
    expect(parsed[0].amount).toBeCloseTo(4.5)
    expect(parsed[1].amount).toBeCloseTo(1234.56)
  })
})
