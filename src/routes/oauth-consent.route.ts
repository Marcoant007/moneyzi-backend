import { FastifyInstance } from 'fastify'
import { OAuthConsentController } from '@/application/controllers/oauth-consent-controller'
import { CreateAuthorizationCodeUseCase } from '@/application/use-cases/oauth-use-case/create-authorization-code.use-case'
import { PrismaOAuthClientRepository } from '@/infra/repositories/prisma/prisma-oauth-client-repository'
import { PrismaOAuthAuthorizationCodeRepository } from '@/infra/repositories/prisma/prisma-oauth-authorization-code-repository'

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
}
