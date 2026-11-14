import { describe, it, expect, vi } from 'vitest'
import { ImportService } from '../import-service'

vi.mock('@/infra/queue/rabbitmq/rabbitmq', () => ({
    publishToQueue: vi.fn(),
}))

vi.mock('@/core/gemini/detect-transactions-batch-with-ia', () => ({
    detectTransactionsBatchWithIA: vi.fn().mockResolvedValue([
        {
            type: 'EXPENSE',
            category: 'Alimentação',
            paymentMethod: 'DEBIT_CARD',
            categoryId: null,
        },
    ]),
}))

describe('ImportService', () => {
    it('detects CSV type', () => {
        const csv = Buffer.from('date,descricao,valor')
        expect(ImportService.detectType(csv)).toBe('csv')
    })

    it('detects OFX type', () => {
        const ofx = Buffer.from('<OFX><STMTTRN>')
        expect(ImportService.detectType(ofx)).toBe('ofx')
    })

    it('parseOnly handles csv and ofx and throws on unknown', () => {
        const csv = Buffer.from('date,descricao,valor')
        const ofx = Buffer.from('<OFX><STMTTRN>')
        const unknown = Buffer.from('random content')

        const csvParsed = ImportService.parseOnly(csv)
        expect(Array.isArray(csvParsed)).toBe(true)

        const ofxParsed = ImportService.parseOnly(ofx)
        expect(Array.isArray(ofxParsed)).toBe(true)

        expect(() => ImportService.parseOnly(unknown)).toThrow()
    })

    it('import publishes messages normalized', async () => {
        const { publishToQueue } = await import('@/infra/queue/rabbitmq/rabbitmq')

        const csv = Buffer.from('Descrição,Valor,Data\n"Padaria","R$ 5,00","01/01/2025"')

        const parsed = await ImportService.import(csv, ' user-1 ', 'job-1')

        expect(parsed).toBeDefined()
        expect(publishToQueue).toHaveBeenCalled()
        // check userId normalized
        const calledArg = (publishToQueue as any).mock.calls[0][0]
        expect(calledArg.userId).toBe('user-1')
        expect(calledArg.importJobId).toBe('job-1')
    })

    it('throws when file type is unknown', async () => {
        const unknown = Buffer.from('no recognizable content')
        await expect(() => ImportService.import(unknown as any, 'u1')).rejects.toThrow()
    })

    describe('region (BR vs US)', () => {
        it('parseOnly defaults to BR-format parsing (dot thousands, comma decimal, DD/MM/YYYY) when region is omitted', () => {
            const csv = Buffer.from('Descricao,Valor,Data\n"Mercado","R$ 1.234,56","15/03/2025"')

            const [parsed] = ImportService.parseOnly(csv) as any[]

            expect(parsed.amount).toBeCloseTo(1234.56)
            expect(parsed.date.getUTCMonth()).toBe(2) // março
            expect(parsed.date.getUTCDate()).toBe(15)
        })

        it('parseOnly parses US-format CSV (comma thousands, dot decimal, MM/DD/YYYY) when region is US', () => {
            const csv = Buffer.from('Description,Amount,Date\n"Grocery Store","$1,234.56","03/15/2025"')

            const [parsed] = ImportService.parseOnly(csv, 'US') as any[]

            expect(parsed.amount).toBeCloseTo(1234.56)
            expect(parsed.date.getUTCMonth()).toBe(2) // March
            expect(parsed.date.getUTCDate()).toBe(15)
        })

        it('import publishes a correctly-parsed message for a US-format CSV', async () => {
            const { publishToQueue } = await import('@/infra/queue/rabbitmq/rabbitmq')

            const csv = Buffer.from('Description,Amount,Date\n"Grocery Store","$45.99","03/15/2025"')

            await ImportService.import(csv, 'user-us', 'job-us', undefined, undefined, 'US')

            expect(publishToQueue).toHaveBeenCalled()
            const calls = (publishToQueue as any).mock.calls
            const message = calls[calls.length - 1][0]
            expect(message.userId).toBe('user-us')
            expect(message.amount).toBeCloseTo(45.99)
            expect(message.name).toBe('Grocery Store')
        })

        it('OFX import is region-agnostic — same result regardless of the region argument', async () => {
            const { publishToQueue } = await import('@/infra/queue/rabbitmq/rabbitmq')

            const ofx = Buffer.from(`
                <OFX>
                  <BANKMSGSRSV1>
                    <STMTTRN>
                      <DTPOSTED>20250315
                      <TRNAMT>-45.99
                      <NAME>Grocery Store
                    </STMTTRN>
                  </BANKMSGSRSV1>
                </OFX>
            `)

            await ImportService.import(ofx, 'user-ofx', 'job-ofx', undefined, undefined, 'US')

            const calls = (publishToQueue as any).mock.calls
            const message = calls[calls.length - 1][0]
            expect(message.amount).toBeCloseTo(-45.99)
            expect(message.name).toBe('Grocery Store')
        })
    })

    describe('credit card invoice', () => {
        it('drops a positive invoice payment and forces EXPENSE/CREDIT_CARD even if the AI says DEPOSIT', async () => {
            const { publishToQueue } = await import('@/infra/queue/rabbitmq/rabbitmq')
            const { detectTransactionsBatchWithIA } = await import('@/core/gemini/detect-transactions-batch-with-ia')
            ;(detectTransactionsBatchWithIA as any).mockResolvedValueOnce([
                { type: 'DEPOSIT', category: 'OTHER', paymentMethod: 'PIX' },
            ])
            ;(publishToQueue as any).mockClear()

            const csv = Buffer.from(
                'Data,Descrição,Valor\n' +
                '"10/03/2025","Mercado","R$ 4.000,00"\n' +
                '"15/03/2025","Pagamento recebido","R$ 4.000,00"',
            )

            await ImportService.import(csv, 'user-cc', 'job-cc', 'card-1', true)

            const messages = (publishToQueue as any).mock.calls.map((c: any[]) => c[0])
            expect(messages).toHaveLength(1)
            expect(messages[0].name).toBe('Mercado')
            expect(messages[0].type).toBe('EXPENSE')
            expect(messages[0].paymentMethod).toBe('CREDIT_CARD')
            expect(messages[0].creditCardId).toBe('card-1')
        })

        it('prepareRows returns the same row count the import publishes (job total stays consistent)', () => {
            const csv = Buffer.from(
                'Data,Descrição,Valor\n' +
                '"10/03/2025","Mercado","R$ 100,00"\n' +
                '"15/03/2025","Pagamento recebido","-R$ 100,00"',
            )

            const parsed = ImportService.parseOnly(csv)
            expect(parsed).toHaveLength(2)
            expect(ImportService.prepareRows(parsed, true)).toHaveLength(1)
            expect(ImportService.prepareRows(parsed, false)).toHaveLength(2)
        })
    })
})
