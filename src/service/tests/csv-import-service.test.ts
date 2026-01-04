import { describe, it, expect, vi } from 'vitest'
import { CsvImportService } from '../csv-import-service'

vi.mock('@/infra/queue/rabbitmq/rabbitmq', () => ({
    publishToQueue: vi.fn(),
}))

describe('CsvImportService', () => {
    it('imports CSV and publishes messages', async () => {
        const { publishToQueue } = await import('@/infra/queue/rabbitmq/rabbitmq')

        const csv = Buffer.from('Descrição,Valor,Data\n"Padaria","R$ 5,00","01/01/2025"')

        await CsvImportService.import(csv, 'user-2')

        expect(publishToQueue).toHaveBeenCalled()
        const calledArg = (publishToQueue as any).mock.calls[0][0]
        expect(calledArg.userId).toBe('user-2')
    })
})
