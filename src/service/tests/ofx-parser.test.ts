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
})
