import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export default async function headerAuth(app: FastifyInstance) {
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const configuredKey = process.env.MONEYZI_APP_KEY
        const providedKey = request.headers['x-api-key'] as string | undefined
        const userId = request.headers['x-user-id'] as string | undefined

        if (!userId) {
            void reply.status(401).send({ error: 'Missing x-user-id header' })
            return
        }

        if (configuredKey && providedKey !== configuredKey) {
            void reply.status(403).send({ error: 'Invalid api key' })
            return
        }
    })
}
