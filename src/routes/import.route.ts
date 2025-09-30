import { prisma } from '@/lib/prisma'
import { ImportService } from '@/service/import-service'
import { ImportJobDto } from '@/core/dtos/import-job.dto'
import { FastifyInstance } from 'fastify'

export async function importRoutes(app: FastifyInstance) {
    // health check
    app.get('/health', async (request, reply) => {
        return reply.send({ ok: true })
    })

    // test route that echoes user id header
    app.get('/test', async (request, reply) => {
        const userId = request.headers['x-user-id'] as string | undefined
        return reply.send({ ok: true, userId: userId ?? null })
    })

    app.post('/import-csv', async (request, reply) => {
        console.log(request)
        const data = await request.file()
        const userId = request.headers['x-user-id'] as string

        if (!data || !userId) {
            return reply.status(400).send({ error: 'Arquivo ou usuário ausente' })
        }

        const buffer = await data.toBuffer()
        try {
            const parsed = ImportService.parseOnly(buffer)

            const job = await prisma.importJob.create({
                data: {
                    userId,
                    total: parsed.length,
                    processed: 0,
                },
            })

            // publish messages with jobId
            await ImportService.import(buffer, userId, job.id)

            const dto: ImportJobDto = {
                id: job.id,
                userId: job.userId,
                status: job.status,
                total: job.total,
                processed: job.processed,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            }

            return reply.status(202).send({ message: 'Arquivo sendo processado', job: dto })
        } catch (err) {
            request.log.error(err)
            return reply.status(500).send({ error: 'Erro ao iniciar importação' })
        }
    })

    app.get('/dashboard', async (request, reply) => {
        try {
            const totalsByType = await prisma.transaction.groupBy({
                by: ['type'],
                _sum: { amount: true }
            })

            const now = new Date()
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

            const monthly = await prisma.transaction.aggregate({
                where: { date: { gte: startOfMonth, lt: endOfMonth } },
                _sum: { amount: true }
            })

            return reply.send({ ok: true, totalsByType, monthly })
        } catch (err) {
            request.log.error(err)
            return reply.status(500).send({ error: 'Erro ao calcular dashboard' })
        }
    })

    // get import job status
    app.get('/import/:id', async (request, reply) => {
        const { id } = request.params as { id: string }
        try {
            const job = await prisma.importJob.findUnique({ where: { id } })
            if (!job) return reply.status(404).send({ error: 'Job não encontrado' })

            const dto: ImportJobDto = {
                id: job.id,
                userId: job.userId,
                status: job.status,
                total: job.total,
                processed: job.processed,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            }

            return reply.send({ ok: true, job: dto })
        } catch (err) {
            request.log.error(err)
            return reply.status(500).send({ error: 'Erro ao buscar job' })
        }
    })
}
