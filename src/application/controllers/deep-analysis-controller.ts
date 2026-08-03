import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { format } from 'date-fns'
import { GetDeepAnalysisUseCase } from '@/application/use-cases/deep-analysis-use-case/get-deep-analysis.use-case'
import { GenerateDeepAnalysisUseCase } from '@/application/use-cases/deep-analysis-use-case/generate-deep-analysis.use-case'
import { GetFinancialGoalSettingsUseCase } from '@/application/use-cases/deep-analysis-use-case/get-financial-goal-settings.use-case'
import { UpdateFinancialGoalSettingsUseCase } from '@/application/use-cases/deep-analysis-use-case/update-financial-goal-settings.use-case'

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export class DeepAnalysisController {
    constructor(
        private getDeepAnalysisUseCase: GetDeepAnalysisUseCase,
        private generateDeepAnalysisUseCase: GenerateDeepAnalysisUseCase,
        private getFinancialGoalSettingsUseCase: GetFinancialGoalSettingsUseCase,
        private updateFinancialGoalSettingsUseCase: UpdateFinancialGoalSettingsUseCase,
    ) { }

    async getDeepAnalysis(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const querySchema = z.object({ period: periodSchema.optional() })

        try {
            const { period } = querySchema.parse(request.query)
            const selectedPeriod = period ?? format(new Date(), 'yyyy-MM')
            const result = await this.getDeepAnalysisUseCase.execute(userId, selectedPeriod)
            return reply.send(result)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to fetch deep analysis' })
        }
    }

    async generateDeepAnalysis(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const bodySchema = z.object({
            period: periodSchema.optional(),
            isPro: z.boolean().optional().default(false),
        })

        try {
            const { period, isPro } = bodySchema.parse(request.body)
            const selectedPeriod = period ?? format(new Date(), 'yyyy-MM')
            const result = await this.generateDeepAnalysisUseCase.execute(userId, selectedPeriod, isPro)
            return reply.send(result)
        } catch (error: any) {
            if (error.message?.startsWith('RATE_LIMIT:')) {
                const limit = error.message.split(':')[1]
                return reply.status(429).send({ error: `Limite de ${limit} análises por dia atingido. Tente novamente amanhã.`, code: 'RATE_LIMIT' })
            }
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to generate deep analysis' })
        }
    }

    async getGoalSettings(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const result = await this.getFinancialGoalSettingsUseCase.execute(userId)
            return reply.send(result)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to fetch goal settings' })
        }
    }

    async updateGoalSettings(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const bodySchema = z.object({
            incomeStability: z.enum(['STABLE', 'VARIABLE']).optional(),
            reserveTargetOverride: z.number().min(0).nullable().optional(),
            reserveMonthlyContribution: z.number().min(0).nullable().optional(),
        })

        try {
            const input = bodySchema.parse(request.body)
            const result = await this.updateFinancialGoalSettingsUseCase.execute(userId, input)
            return reply.send(result)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to update goal settings' })
        }
    }
}
