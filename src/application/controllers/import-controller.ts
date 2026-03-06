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
        
        // Ler campos do multipart form de maneira resiliente.
        // Alguns clientes enviam valores como objeto ({ value }) e outros como string.
        const creditCardId = this.readMultipartFieldValue(data.fields?.creditCardId)
        const isCreditCardInvoiceRaw = this.readMultipartFieldValue(data.fields?.isCreditCardInvoice)
        const parsedInvoiceFlag = this.parseBooleanField(isCreditCardInvoiceRaw)
        const isCreditCardInvoice = parsedInvoiceFlag ?? Boolean(creditCardId)

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

    private readMultipartFieldValue(field: unknown): string | undefined {
        if (field == null) return undefined
        if (Array.isArray(field)) {
            for (const item of field) {
                const value = this.readMultipartFieldValue(item)
                if (value) return value
            }
            return undefined
        }

        if (typeof field === 'string') {
            const trimmed = field.trim()
            return trimmed ? trimmed : undefined
        }

        if (typeof field === 'number' || typeof field === 'boolean') {
            return String(field)
        }

        if (typeof field === 'object' && 'value' in field) {
            return this.readMultipartFieldValue((field as { value: unknown }).value)
        }

        return undefined
    }

    private parseBooleanField(value: string | undefined): boolean | undefined {
        if (value == null) return undefined

        const normalized = value.trim().toLowerCase()
        if (['true', '1', 'on', 'yes', 'y'].includes(normalized)) return true
        if (['false', '0', 'off', 'no', 'n'].includes(normalized)) return false
        return undefined
    }
}
