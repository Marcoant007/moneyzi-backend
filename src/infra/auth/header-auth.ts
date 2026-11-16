import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import logger from '@/lib/logger'
import { safeEqual } from '@/utils/safe-equal'

/**
 * Autenticação servidor-a-servidor: só o Next.js (que validou a sessão no
 * Clerk) conhece MONEYZI_APP_KEY e pode afirmar quem é o usuário via
 * x-user-id. A URL deste backend é pública, então sem a chave configurada
 * NADA passa (fail-closed) — antes, a ausência da env liberava qualquer
 * x-user-id, ou seja, acesso aos dados de qualquer usuário.
 */
export default async function headerAuth(app: FastifyInstance) {
    if (!process.env.MONEYZI_APP_KEY) {
        logger.error('MONEYZI_APP_KEY não configurada: todas as rotas protegidas vão responder 503')
    }

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const configuredKey = process.env.MONEYZI_APP_KEY
        const providedKey = request.headers['x-api-key']
        const userId = request.headers['x-user-id']

        if (!configuredKey) {
            void reply.status(503).send({ error: 'Service misconfigured' })
            return
        }

        if (typeof providedKey !== 'string' || !safeEqual(providedKey, configuredKey)) {
            void reply.status(403).send({ error: 'Invalid api key' })
            return
        }

        if (typeof userId !== 'string' || !userId) {
            void reply.status(401).send({ error: 'Missing x-user-id header' })
            return
        }
    })
}
