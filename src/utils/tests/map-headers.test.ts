import { describe, it, expect } from 'vitest'
import { mapHeaders } from '@/utils/map-headers'

describe('mapHeaders', () => {
  it('maps common Portuguese and English headers to ParsedTransaction keys', () => {
    const headers = ['Descrição', 'Valor', 'Data', 'Categoria', 'Tipo', 'Metodo de Pagamento', 'Other']
    const mapped = mapHeaders(headers)

    expect(mapped['Descrição']).toBe('name')
    expect(mapped['Valor']).toBe('amount')
    expect(mapped['Data']).toBe('date')
    expect(mapped['Categoria']).toBe('category')
    expect(mapped['Tipo']).toBe('type')
    expect(mapped['Metodo de Pagamento']).toBe('paymentMethod')
    expect(mapped['Other']).toBeUndefined()
  })

  it('maps a US card export header set (English-only) to ParsedTransaction keys', () => {
    const headers = ['Description', 'Amount', 'Transaction Date', 'Category', 'Type', 'Payment Method', 'Other']
    const mapped = mapHeaders(headers)

    expect(mapped['Description']).toBe('name')
    expect(mapped['Amount']).toBe('amount')
    expect(mapped['Transaction Date']).toBe('date')
    expect(mapped['Category']).toBe('category')
    expect(mapped['Type']).toBe('type')
    expect(mapped['Payment Method']).toBe('paymentMethod')
    expect(mapped['Other']).toBeUndefined()
  })
})
