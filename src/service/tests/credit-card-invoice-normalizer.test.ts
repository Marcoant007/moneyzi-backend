import { describe, it, expect } from 'vitest'
import {
    isInvoicePaymentDescription,
    isPreviousBalanceDescription,
    normalizeCreditCardInvoiceRows,
} from '../credit-card-invoice-normalizer'

describe('isPreviousBalanceDescription', () => {
    it.each([
        'Valor pendente do mês anterior',
        'Saldo anterior',
        'SALDO DA FATURA ANTERIOR',
        'Saldo em atraso',
        'Restante da fatura anterior',
        'PREVIOUS BALANCE',
    ])('detects previous-invoice balance: %s', (name) => {
        expect(isPreviousBalanceDescription(name)).toBe(true)
    })

    it.each([
        'Juros por fatura atrasada',
        'Multa por fatura atrasada',
        'IOF por fatura atrasada',
        'Alura - Parcela 4/12',
        'Parcelamento de fatura 2/6',
    ])('keeps a real charge: %s', (name) => {
        expect(isPreviousBalanceDescription(name)).toBe(false)
    })
})

describe('isInvoicePaymentDescription', () => {
    it.each([
        'Pagamento recebido',
        'PAGAMENTO EFETUADO',
        'Pagamento on line',
        'Pagamento de fatura',
        'PAGTO DEBITO AUTOMATICO',
        'PAGTO. POR DEB EM C/C',
        'PGTO FATURA',
        'DEB AUTOM DE FATURA EM C/C',
        'Inclusão de Pagamento',
        'PAYMENT - THANK YOU',
        'AUTOPAY PAYMENT',
        'ONLINE PAYMENT',
    ])('detects invoice payment: %s', (name) => {
        expect(isInvoicePaymentDescription(name)).toBe(true)
    })

    it.each([
        'PAG*JoseDaSilva',
        'PAG*ContaSimples',
        'Mercado Pago*Loja',
        'iFood',
        'Uber *Trip',
        'Netflix.com',
        'Pagar.me*Academia',
    ])('does not flag a purchase: %s', (name) => {
        expect(isInvoicePaymentDescription(name)).toBe(false)
    })
})

describe('normalizeCreditCardInvoiceRows', () => {
    it('drops a POSITIVE invoice payment so a paid R$ 4.000 invoice is not counted as R$ 8.000', () => {
        const rows = [
            { name: 'Mercado', amount: 1500 },
            { name: 'Posto', amount: 2500 },
            { name: 'Pagamento recebido', amount: 4000 },
        ]

        const result = normalizeCreditCardInvoiceRows(rows)

        expect(result.rows.map((r) => r.name)).toEqual(['Mercado', 'Posto'])
        expect(result.rows.reduce((s, r) => s + r.amount, 0)).toBe(4000)
        expect(result.removedPayments).toBe(1)
        expect(result.flippedSign).toBe(false)
    })

    it('keeps the Nubank convention working (purchases positive, payment negative)', () => {
        const rows = [
            { name: 'Mercado', amount: 100 },
            { name: 'Farmácia', amount: 50 },
            { name: 'Pagamento recebido', amount: -150 },
        ]

        const result = normalizeCreditCardInvoiceRows(rows)

        expect(result.rows).toEqual([
            { name: 'Mercado', amount: 100 },
            { name: 'Farmácia', amount: 50 },
        ])
    })

    it('flips the sign when the file uses "purchases negative" (OFX) instead of dropping every purchase', () => {
        const rows = [
            { name: 'Mercado', amount: -100 },
            { name: 'Farmácia', amount: -50 },
            { name: 'Estorno Loja', amount: 20 },
            { name: 'PAYMENT - THANK YOU', amount: 150 },
        ]

        const result = normalizeCreditCardInvoiceRows(rows)

        expect(result.flippedSign).toBe(true)
        expect(result.rows).toEqual([
            { name: 'Mercado', amount: 100 },
            { name: 'Farmácia', amount: 50 },
        ])
        expect(result.removedPayments).toBe(1)
        expect(result.removedCredits).toBe(1)
    })

    it('drops the previous-invoice balance so a late Nubank invoice of R$ 307,96 is not counted as R$ 690,98', () => {
        // Real Nubank export (fatura paga com atraso).
        const rows = [
            { name: 'Juros por fatura atrasada', amount: 7.91 },
            { name: 'Multa por fatura atrasada', amount: 7.68 },
            { name: 'IOF por fatura atrasada', amount: 1.58 },
            { name: 'Pagamento recebido', amount: -383.03 },
            { name: 'Valor pendente do mês anterior', amount: 383.02 },
            { name: 'Alura - Parcela 4/12', amount: 95.16 },
            { name: 'Jim.Com* 53140184 Mar - Parcela 7/10', amount: 195.63 },
        ]

        const result = normalizeCreditCardInvoiceRows(rows)
        const total = result.rows.reduce((s, r) => s + r.amount, 0)

        expect(result.rows.map((r) => r.name)).toEqual([
            'Juros por fatura atrasada',
            'Multa por fatura atrasada',
            'IOF por fatura atrasada',
            'Alura - Parcela 4/12',
            'Jim.Com* 53140184 Mar - Parcela 7/10',
        ])
        expect(total).toBeCloseTo(307.96, 2)
        expect(result.removedPayments).toBe(2)
    })

    it('still drops unnamed negative credits and rows without a numeric amount', () => {
        const rows = [
            { name: 'Mercado', amount: 100 },
            { name: 'Ajuste', amount: -10 },
            { name: 'Sem valor', amount: undefined },
            { name: 'Zero', amount: 0 },
        ]

        const result = normalizeCreditCardInvoiceRows(rows)

        expect(result.rows).toEqual([{ name: 'Mercado', amount: 100 }])
    })
})
