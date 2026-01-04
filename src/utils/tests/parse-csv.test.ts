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
})
