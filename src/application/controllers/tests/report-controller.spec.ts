import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportController } from '@/application/controllers/report-controller'

function makeReply() {
    const reply = {
        status: vi.fn(),
        send: vi.fn(),
    } as any

    reply.status.mockReturnValue(reply)
    return reply
}

describe('ReportController', () => {
    const getDashboardReportUseCase = {
        execute: vi.fn(),
    } as any

    const getMonthlySummaryUseCase = {
        execute: vi.fn(),
    } as any

    const getAiInsightsUseCase = {
        execute: vi.fn(),
    } as any

    const controller = new ReportController(
        getDashboardReportUseCase,
        getMonthlySummaryUseCase,
        getAiInsightsUseCase,
    )

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('keeps dashboard endpoint behavior unchanged', async () => {
        const request = {
            headers: { 'x-user-id': 'user-1' },
            query: { period: 'thisMonth' },
        } as any
        const reply = makeReply()

        getDashboardReportUseCase.execute.mockResolvedValue({ forecast: [] })

        await controller.getDashboard(request, reply)

        expect(getDashboardReportUseCase.execute).toHaveBeenCalledWith('user-1', 'thisMonth')
        expect(reply.send).toHaveBeenCalledWith({ forecast: [] })
    })

    it('validates month query and returns monthly summary', async () => {
        const request = {
            headers: { 'x-user-id': 'user-1' },
            query: { month: '2026-03' },
        } as any
        const reply = makeReply()

        getMonthlySummaryUseCase.execute.mockResolvedValue({ month: '2026-03' })

        await controller.getMonthlySummary(request, reply)

        expect(getMonthlySummaryUseCase.execute).toHaveBeenCalledWith('user-1', '2026-03')
        expect(reply.send).toHaveBeenCalledWith({ month: '2026-03' })
    })

    it('defaults month to current month when query is omitted', async () => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(new Date('2026-03-17T10:00:00.000Z'))

            const request = {
                headers: { 'x-user-id': 'user-1' },
                query: {},
            } as any
            const reply = makeReply()

            getMonthlySummaryUseCase.execute.mockResolvedValue({ month: '2026-03' })

            await controller.getMonthlySummary(request, reply)

            expect(getMonthlySummaryUseCase.execute).toHaveBeenCalledWith('user-1', '2026-03')
        } finally {
            vi.useRealTimers()
        }
    })

    it('returns 400 for invalid month query', async () => {
        const request = {
            headers: { 'x-user-id': 'user-1' },
            query: { month: '03-2026' },
        } as any
        const reply = makeReply()

        await controller.getMonthlySummary(request, reply)

        expect(getMonthlySummaryUseCase.execute).not.toHaveBeenCalled()
        expect(reply.status).toHaveBeenCalledWith(400)
    })
})
