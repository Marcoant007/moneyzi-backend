import type { FastifyReply, FastifyRequest } from 'fastify'
import { StartImportUseCase } from '@/application/use-cases/import-use-case/start-import.use-case'
import { GetImportJobStatusUseCase } from '@/application/use-cases/import-use-case/get-import-job-status.use-case'
import { GetDashboardUseCase } from '@/application/use-cases/dashboard-use-case/get-dashboard.use-case'

export class ImportController {
    constructor(
        private readonly startImportUseCase: StartImportUseCase,
        private readonly getImportJobStatusUseCase: GetImportJobStatusUseCase,
        private readonly getDashboardUseCase: GetDashboardUseCase,
    ) { }

    async importCsv(request: FastifyRequest, reply: FastifyReply) {
        const rawUserId = request.headers['x-user-id']
        const userId = Array.isArray(rawUserId)
            ? rawUserId.filter(Boolean)[0]?.trim()
            : rawUserId?.trim()

        request.log.info({ url: request.url, userId: userId ?? null }, 'Import request received')

        const data = await request.file().catch(() => null)
        if (!data || !userId) {
            return reply.status(400).send({ error: 'Arquivo ou usuário ausente' })
        }

        const buffer = await data.toBuffer()
        
        // Ler campos do multipart form
        const creditCardId = typeof data.fields.creditCardId === 'object' && 'value' in data.fields.creditCardId
            ? String(data.fields.creditCardId.value)
            : undefined
        const isCreditCardInvoice = typeof data.fields.isCreditCardInvoice === 'object' && 'value' in data.fields.isCreditCardInvoice
            ? String(data.fields.isCreditCardInvoice.value) === 'true'
            : false

        try {
            const { job } = await this.startImportUseCase.execute({
                userId,
                fileBuffer: buffer,
                creditCardId,
                isCreditCardInvoice
            })
            return reply.status(202).send({ message: 'Arquivo sendo processado', job })
        } catch (error) {
            request.log.error(error)

            if (error instanceof Error) {
                if (error.message === 'Usuário não encontrado') {
                    return reply.status(400).send({ error: 'Usuário não encontrado' })
                }
                if (error.message === 'Usuário inválido') {
                    return reply.status(400).send({ error: 'Usuário inválido' })
                }
                if (error.message.startsWith('Erro ao processar arquivo:')) {
                    return reply.status(400).send({ error: error.message })
                }
                if (error.message.startsWith('Erro ao criar job de importação:')) {
                    return reply.status(500).send({ error: error.message })
                }
                if (error.message.startsWith('Erro ao iniciar processamento:')) {
                    return reply.status(500).send({ error: error.message })
                }
            }

            return reply.status(500).send({ error: 'Erro ao iniciar importação' })
        }
    }

    async getDashboard(request: FastifyRequest, reply: FastifyReply) {
        try {
            const { month, year } = request.query as { month?: string; year?: string }
            const rawUserId = request.headers['x-user-id']
            const userId = Array.isArray(rawUserId)
                ? rawUserId.filter(Boolean)[0]?.trim()
                : rawUserId?.trim()

            const dashboardData = await this.getDashboardUseCase.execute({ userId, month, year })
            return reply.send({ ok: true, ...dashboardData })
        } catch (error) {
            request.log.error(error)
            return reply.status(500).send({ error: 'Erro ao calcular dashboard' })
        }
    }

    async getImportJobStatus(request: FastifyRequest, reply: FastifyReply) {
        const { id } = request.params as { id: string }

        try {
            const { job } = await this.getImportJobStatusUseCase.execute({ id })
            if (!job) {
                return reply.status(404).send({ error: 'Job não encontrado' })
            }

            return reply.send({ ok: true, job })
        } catch (error) {
            request.log.error(error)
            return reply.status(500).send({ error: 'Erro ao buscar job' })
        }
    }
}
