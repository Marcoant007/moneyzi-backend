import { publishToQueue } from '@infra/mensageria/rabbitmq/rabbitmq'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export async function importRoutes(app: FastifyInstance) {
    app.post('/import-csv', async (request, reply) => {
        const body = await request.body as any

        const schema = z.object({
            userId: z.string(),
            csvContent: z.string()
        })

        const result = schema.safeParse(body)
        if (!result.success) {
            return reply.status(400).send({ error: 'Dados inválidos' })
        }

        publishToQueue(result.data)

        return reply.status(202).send({ message: 'Arquivo está sendo processado' })
    })
}
