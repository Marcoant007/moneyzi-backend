import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImportController } from '@/application/controllers/import-controller'

function makeReply() {
    const reply = {
        status: vi.fn(),
        send: vi.fn(),
    } as any

    reply.status.mockReturnValue(reply)
    return reply
}

function makeRequest(fields: Record<string, unknown>) {
    return {
        headers: { 'x-user-id': 'user-1' },
        url: '/import-csv',
        log: {
            info: vi.fn(),
            error: vi.fn(),
        },
        file: vi.fn().mockResolvedValue({
            fields,
            toBuffer: vi.fn().mockResolvedValue(Buffer.from('csv,data')),
        }),
    } as any
}

function makeJob() {
    return {
        id: 'job-1',
        userId: 'user-1',
        status: 'PROCESSING',
        total: 1,
        processed: 0,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    }
}

describe('ImportController', () => {
    const startImportUseCase = {
        execute: vi.fn(),
    } as any

    const getImportJobStatusUseCase = {
        execute: vi.fn(),
    } as any

    const getDashboardUseCase = {
        execute: vi.fn(),
    } as any

    const controller = new ImportController(
        startImportUseCase,
        getImportJobStatusUseCase,
        getDashboardUseCase,
    )

    beforeEach(() => {
        vi.clearAllMocks()
        startImportUseCase.execute.mockResolvedValue({ job: makeJob() })
    })

    it('reads multipart object fields and sends isCreditCardInvoice=true', async () => {
        const request = makeRequest({
            creditCardId: { value: 'card-1' },
            isCreditCardInvoice: { value: 'true' },
        })
        const reply = makeReply()

        await controller.importCsv(request, reply)

        expect(startImportUseCase.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                creditCardId: 'card-1',
                isCreditCardInvoice: true,
            }),
        )
    })

    it('accepts boolean-like string values (on/1/yes)', async () => {
        const request = makeRequest({
            creditCardId: { value: 'card-1' },
            isCreditCardInvoice: { value: 'on' },
        })
        const reply = makeReply()

        await controller.importCsv(request, reply)

        expect(startImportUseCase.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                isCreditCardInvoice: true,
            }),
        )
    })

    it('defaults to invoice mode when creditCardId exists but flag is missing', async () => {
        const request = makeRequest({
            creditCardId: { value: 'card-1' },
        })
        const reply = makeReply()

        await controller.importCsv(request, reply)

        expect(startImportUseCase.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                creditCardId: 'card-1',
                isCreditCardInvoice: true,
            }),
        )
    })

    it('respects explicit false flag', async () => {
        const request = makeRequest({
            creditCardId: { value: 'card-1' },
            isCreditCardInvoice: { value: 'false' },
        })
        const reply = makeReply()

        await controller.importCsv(request, reply)

        expect(startImportUseCase.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                isCreditCardInvoice: false,
            }),
        )
    })
})
