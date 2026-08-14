import { describe, it, expect } from 'vitest'
import { OfxParser } from '../parsers/ofx-parser'

describe('OfxParser', () => {
    it('parses OFX content into transactions', () => {
        const ofx = `
      <OFX>
        <BANKMSGSRSV1>
          <STMTTRN>
            <DTPOSTED>20250101
            <TRNAMT>-123.45
            <NAME>Padaria
          </STMTTRN>
          <STMTTRN>
            <DTPOSTED>20250202
            <TRNAMT>200.00
            <MEMO>Transferencia
          </STMTTRN>
        </BANKMSGSRSV1>
      </OFX>
    `

        const parsed = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed.length).toBe(2)
        expect(parsed[0].amount).toBeCloseTo(-123.45)
        expect(parsed[0].name).toBe('Padaria')
        expect(parsed[1].name).toBe('Transferencia')
    })

    // OFX é um formato bancário padronizado: data sempre YYYYMMDD e valor sempre
    // decimal com ponto, não importa o banco ou país de origem do extrato. Por
    // isso o parser não recebe (nem precisa de) um parâmetro de região — os
    // testes abaixo comprovam isso explicitamente pra um extrato "estilo BR"
    // (banco brasileiro, nomes em português) e um "estilo US" (banco americano,
    // nomes em inglês), usando o mesmo código sem nenhuma ramificação.
    it('parses a Brazilian-bank-style export correctly (no region branching needed)', () => {
        const ofx = `
      <OFX>
        <BANKMSGSRSV1>
          <STMTTRN>
            <DTPOSTED>20250315
            <TRNAMT>-1234.56
            <NAME>Supermercado Extra
          </STMTTRN>
        </BANKMSGSRSV1>
      </OFX>
    `

        const [parsed] = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed.amount).toBeCloseTo(-1234.56)
        expect(parsed.date).toEqual(new Date('2025-03-15'))
        expect(parsed.name).toBe('Supermercado Extra')
    })

    it('parses a US-bank-style export correctly (same code path, no region needed)', () => {
        const ofx = `
      <OFX>
        <BANKMSGSRSV1>
          <STMTTRN>
            <DTPOSTED>20250315
            <TRNAMT>-1234.56
            <NAME>Whole Foods Market
          </STMTTRN>
        </BANKMSGSRSV1>
      </OFX>
    `

        const [parsed] = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed.amount).toBeCloseTo(-1234.56)
        expect(parsed.date).toEqual(new Date('2025-03-15'))
        expect(parsed.name).toBe('Whole Foods Market')
    })

    it('handles positive amounts (deposits/credits) with full cent precision', () => {
        const ofx = `
      <OFX>
        <STMTTRN>
          <DTPOSTED>20250704
          <TRNAMT>2500.99
          <NAME>Salary Deposit
        </STMTTRN>
      </OFX>
    `

        const [parsed] = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed.amount).toBeCloseTo(2500.99)
        expect(parsed.date).toEqual(new Date('2025-07-04'))
    })

    it('falls back to MEMO when NAME is absent, regardless of language', () => {
        const ofx = `
      <OFX>
        <STMTTRN>
          <DTPOSTED>20250101
          <TRNAMT>-50.00
          <MEMO>Wire Transfer Fee
        </STMTTRN>
      </OFX>
    `

        const [parsed] = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed.name).toBe('Wire Transfer Fee')
    })

    it('ignores unparseable dates instead of throwing', () => {
        const ofx = `
      <OFX>
        <STMTTRN>
          <DTPOSTED>2025
          <TRNAMT>-10.00
          <NAME>Bad Date Entry
        </STMTTRN>
      </OFX>
    `

        const [parsed] = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed.date).toBeUndefined()
        expect(parsed.amount).toBeCloseTo(-10)
    })

    it('returns an empty array for content with no STMTTRN blocks', () => {
        const ofx = '<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>'

        const parsed = OfxParser.parse(Buffer.from(ofx, 'utf-8'))

        expect(parsed).toEqual([])
    })
})
