import { publishToQueue } from '@/infra/queue/rabbitmq/rabbitmq'
import { CsvImportService } from '@/service/csv-import-service'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export async function importRoutes(app: FastifyInstance) {
    app.post('/import-csv', async (request, reply) => {
        console.log(request)
        const data = await request.file()
        const userId = request.headers['x-user-id'] as string

        if (!data || !userId) {
            return reply.status(400).send({ error: 'Arquivo ou usuário ausente' })
        }

        const buffer = await data.toBuffer()
        await CsvImportService.import(buffer, userId)

        return reply.status(202).send({ message: 'Arquivo sendo processado' })
    })
}
