import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PrismaMcpTokenRepository } from '@/infra/repositories/prisma/prisma-mcp-token-repository'
import { hashMcpToken } from '@/utils/mcp-token.utils'

declare module 'fastify' {
    interface FastifyRequest {
        mcpUserId?: string
        mcpScope?: string
    }
}

/**
 * Autentica o /mcp por token pessoal guardado (com hash) no banco — cada
 * token resolve pro userId do seu dono, nunca um valor fixo de env var.
 */
export default async function mcpBearerAuth(app: FastifyInstance) {
    const mcpTokenRepository = new PrismaMcpTokenRepository()

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers.authorization
        const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined

        if (!providedToken) {
            void reply.status(401).send({ error: 'Invalid or missing bearer token' })
            return
        }

        const tokenHash = hashMcpToken(providedToken)
        const activeToken = await mcpTokenRepository.findActiveByTokenHash(tokenHash)

        if (!activeToken) {
            void reply.status(401).send({ error: 'Invalid or missing bearer token' })
            return
        }

        request.mcpUserId = activeToken.userId
        request.mcpScope = activeToken.scope
        void mcpTokenRepository.touchLastUsedAt(activeToken.id).catch(() => {
            // best-effort; não deve bloquear/derrubar a chamada MCP
        })
    })
}
