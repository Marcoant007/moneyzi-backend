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
})
