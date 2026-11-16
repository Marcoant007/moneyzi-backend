import { FastifyInstance } from 'fastify'
import { OAuthConsentController } from '@/application/controllers/oauth-consent-controller'
import { CreateAuthorizationCodeUseCase } from '@/application/use-cases/oauth-use-case/create-authorization-code.use-case'
import { PrismaOAuthClientRepository } from '@/infra/repositories/prisma/prisma-oauth-client-repository'
import { PrismaOAuthAuthorizationCodeRepository } from '@/infra/repositories/prisma/prisma-oauth-authorization-code-repository'
import { FindOAuthClientByIdUseCase } from '@/application/use-cases/oauth-use-case/find-oauth-client-by-id.use-case'

function buildOAuthConsentController(): OAuthConsentController {
    const oauthClientRepository = new PrismaOAuthClientRepository()
    const oauthAuthorizationCodeRepository = new PrismaOAuthAuthorizationCodeRepository()

    return new OAuthConsentController(
        new CreateAuthorizationCodeUseCase(oauthClientRepository, oauthAuthorizationCodeRepository),
    )
}

/**
 * Endpoint interno, registrado dentro do bloco headerAuth (igual
 * mcp-token.route.ts) — só o Next.js chama isso, depois que o usuário
 * aprova o consentimento em /oauth/consent.
 */
export async function oauthConsentRoutes(app: FastifyInstance) {
    const controller = buildOAuthConsentController()

    app.post('/oauth/authorization-codes', (req, reply) => controller.createAuthorizationCode(req, reply))

    // A tela de consentimento usa isto em vez de confiar no client_name e no
    // redirect_uri da URL (que qualquer um edita para se passar pelo ChatGPT).
    const findClient = new FindOAuthClientByIdUseCase(new PrismaOAuthClientRepository())
    app.get('/oauth/clients/:id', async (req, reply) => {
        const { id } = req.params as { id: string }
        const client = await findClient.execute(id).catch(() => null)
        if (!client) {
            return reply.status(404).send({ error: 'unknown client_id' })
        }
        return reply.send({
            id: client.id,
            clientName: client.clientName,
            redirectUris: client.redirectUris,
        })
    })
}
