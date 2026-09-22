import { FastifyInstance } from 'fastify'
import { OAuthController } from '@/application/controllers/oauth-controller'
import { RegisterOAuthClientUseCase } from '@/application/use-cases/oauth-use-case/register-oauth-client.use-case'
import { FindOAuthClientByIdUseCase } from '@/application/use-cases/oauth-use-case/find-oauth-client-by-id.use-case'
import { ExchangeAuthorizationCodeUseCase } from '@/application/use-cases/oauth-use-case/exchange-authorization-code.use-case'
import { CreateMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/create-mcp-token.use-case'
import { PrismaOAuthClientRepository } from '@/infra/repositories/prisma/prisma-oauth-client-repository'
import { PrismaOAuthAuthorizationCodeRepository } from '@/infra/repositories/prisma/prisma-oauth-authorization-code-repository'
import { PrismaMcpTokenRepository } from '@/infra/repositories/prisma/prisma-mcp-token-repository'

function buildOAuthController(): OAuthController {
    const oauthClientRepository = new PrismaOAuthClientRepository()
    const oauthAuthorizationCodeRepository = new PrismaOAuthAuthorizationCodeRepository()
    const mcpTokenRepository = new PrismaMcpTokenRepository()

    const issuerUrl = process.env.OAUTH_ISSUER_URL || 'http://localhost:3333'
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

    return new OAuthController(
        new RegisterOAuthClientUseCase(oauthClientRepository),
        new FindOAuthClientByIdUseCase(oauthClientRepository),
        new ExchangeAuthorizationCodeUseCase(
            oauthAuthorizationCodeRepository,
            oauthClientRepository,
            new CreateMcpTokenUseCase(mcpTokenRepository),
        ),
        issuerUrl,
        frontendUrl,
    )
}

/**
 * Servidor OAuth 2.1 + DCR (RFC 7591) público que emite os McpToken usados
 * pelo /mcp — ver mcp.route.ts. Registrado fora do headerAuth: quem chama
 * esses endpoints é o próprio cliente OAuth (ex. ChatGPT), não o Next.js.
 */
export async function oauthRoutes(app: FastifyInstance) {
    const controller = buildOAuthController()

    app.get('/.well-known/oauth-authorization-server', (req, reply) =>
        controller.authorizationServerMetadataHandler(req, reply),
    )
    app.get('/.well-known/oauth-protected-resource', (req, reply) =>
        controller.protectedResourceMetadataHandler(req, reply),
    )
    app.post('/oauth/register', (req, reply) => controller.register(req, reply))
    app.get('/oauth/authorize', (req, reply) => controller.authorize(req, reply))
    app.post('/oauth/token', (req, reply) => controller.token(req, reply))
}
