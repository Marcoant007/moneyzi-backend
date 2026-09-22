import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { CreateAuthorizationCodeUseCase, CreateAuthorizationCodeError } from '@/application/use-cases/oauth-use-case/create-authorization-code.use-case'

const createCodeBodySchema = z.object({
    clientId: z.string().min(1),
    redirectUri: z.string().min(1),
    state: z.string().optional(),
    codeChallenge: z.string().min(1),
    codeChallengeMethod: z.string().min(1),
    scope: z.string().min(1),
})

/**
 * Chamado só pelo Next.js (dentro do headerAuth, x-user-id já validado),
 * depois que o usuário aprova o consentimento em /oauth/consent. Devolve a
 * URL de callback do ChatGPT já pronta pra server action só fazer redirect().
 */
export class OAuthConsentController {
    constructor(private readonly createAuthorizationCodeUseCase: CreateAuthorizationCodeUseCase) {}

    async createAuthorizationCode(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const body = createCodeBodySchema.parse(request.body ?? {})
            const { code } = await this.createAuthorizationCodeUseCase.execute({
                userId,
                clientId: body.clientId,
                redirectUri: body.redirectUri,
                codeChallenge: body.codeChallenge,
                codeChallengeMethod: body.codeChallengeMethod,
                scope: body.scope,
            })

            const redirectTo = new URL(body.redirectUri)
            redirectTo.searchParams.set('code', code)
            if (body.state) redirectTo.searchParams.set('state', body.state)

            return reply.status(201).send({ redirectTo: redirectTo.toString() })
        } catch (error: any) {
            if (error instanceof CreateAuthorizationCodeError) {
                return reply.status(400).send({ error: error.message })
            }
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to create authorization code' })
        }
    }
}
