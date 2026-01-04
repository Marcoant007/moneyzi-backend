import { describe, it, expect, vi } from 'vitest'
import { ImportService } from '../import-service'

vi.mock('@/infra/queue/rabbitmq/rabbitmq', () => ({
    publishToQueue: vi.fn(),
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
})
