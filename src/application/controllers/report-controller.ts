import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { GetDashboardReportUseCase } from '@/application/use-cases/dashboard-use-case/get-dashboard-report.use-case'
import { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { GetAiInsightsUseCase } from '@/application/use-cases/dashboard-use-case/get-ai-insights.use-case'
import { format } from 'date-fns'

export class ReportController {
    constructor(
        private getDashboardReportUseCase: GetDashboardReportUseCase,
        private getMonthlySummaryUseCase: GetMonthlySummaryUseCase,
        private getAiInsightsUseCase: GetAiInsightsUseCase,
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

    async getMonthlySummary(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const querySchema = z.object({
            month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
        })

        try {
            const { month } = querySchema.parse(request.query)
            const selectedMonth = month ?? format(new Date(), 'yyyy-MM')
            const report = await this.getMonthlySummaryUseCase.execute(userId, selectedMonth)
            return reply.send(report)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to generate monthly summary' })
        }
    }

    async getAiInsights(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const bodySchema = z.object({
            isPro: z.boolean().optional().default(false),
            context: z.object({
                income: z.number(),
                expenses: z.number(),
                balance: z.number(),
                commitmentRate: z.number(),
                fixedExpenses: z.object({ total: z.number(), incomePercent: z.number() }),
                variableExpenses: z.object({
                    total: z.number(),
                    incomePercent: z.number(),
                    topCategory: z.object({ category: z.string(), total: z.number() }).nullable(),
                }),
                creditCardAnalysis: z.object({
                    total: z.number(),
                    expensePercent: z.number(),
                    isDominant: z.boolean(),
                    topCategory: z.object({ name: z.string(), total: z.number() }).nullable(),
                }),
                topOffenders: z.array(z.object({
                    category: z.string(),
                    total: z.number(),
                    incomePercent: z.number(),
                })),
                rule503020: z.object({
                    needs: z.object({ actualPercent: z.number() }),
                    wants: z.object({ actualPercent: z.number() }),
                    future: z.object({ actualPercent: z.number(), total: z.number() }),
                }),
            }),
        })

        try {
            const { isPro, context } = bodySchema.parse(request.body)
            const result = await this.getAiInsightsUseCase.execute(userId, isPro, context)
            return reply.send(result)
        } catch (error: any) {
            if (error.message?.startsWith('RATE_LIMIT:')) {
                const limit = error.message.split(':')[1]
                return reply.status(429).send({ error: `Limite de ${limit} análises por dia atingido. Tente novamente amanhã.`, code: 'RATE_LIMIT' })
            }
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to generate AI insights' })
        }
    }
}
