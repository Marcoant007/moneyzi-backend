import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { GetDashboardReportUseCase } from '@/application/use-cases/get-dashboard-report.use-case'

export class ReportController {
    constructor(
        private getDashboardReportUseCase: GetDashboardReportUseCase
    ) { }

    async getDashboard(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const querySchema = z.object({
            period: z.enum(['thisMonth', 'last3Months', 'last6Months', 'last12Months']).optional().default('thisMonth')
        })

        try {
            const { period } = querySchema.parse(request.query)
            const report = await this.getDashboardReportUseCase.execute(userId, period)
            return reply.send(report)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to generate report' })
        }
    }
}
