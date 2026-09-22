import type { OAuthClientRepository } from '@/application/repositories/oauth-client-repository'
import type { OAuthAuthorizationCodeRepository } from '@/application/repositories/oauth-authorization-code-repository'
import { generateAuthorizationCode, hashAuthorizationCode } from '@/utils/oauth.utils'

export class CreateAuthorizationCodeError extends Error {
    constructor(message: string) {
        super(message)
    }
}

const CODE_TTL_MS = 10 * 60 * 1000

export interface CreateAuthorizationCodeInput {
    userId: string
    clientId: string
    redirectUri: string
    codeChallenge: string
    codeChallengeMethod: string
    scope: string
}

/**
 * Materializa o code depois que o usuário aprova o consentimento na tela do
 * Next.js. Revalida client_id/redirect_uri contra o que está registrado —
 * nunca confia cegamente no que o frontend mandou, mesmo sendo uma chamada
 * interna autenticada (defesa em profundidade).
 */
export class CreateAuthorizationCodeUseCase {
    constructor(
        private readonly oauthClientRepository: OAuthClientRepository,
        private readonly oauthAuthorizationCodeRepository: OAuthAuthorizationCodeRepository,
    ) {}

    async execute(input: CreateAuthorizationCodeInput): Promise<{ code: string }> {
        const client = await this.oauthClientRepository.findById(input.clientId)
        if (!client) {
            throw new CreateAuthorizationCodeError('unknown client_id')
        }

        if (!client.redirectUris.includes(input.redirectUri)) {
            throw new CreateAuthorizationCodeError('redirect_uri is not registered for this client')
        }

        if (input.codeChallengeMethod !== 'S256') {
            throw new CreateAuthorizationCodeError('only the S256 code_challenge_method is supported')
        }

        const code = generateAuthorizationCode()
        const codeHash = hashAuthorizationCode(code)

        await this.oauthAuthorizationCodeRepository.create({
            codeHash,
            clientId: input.clientId,
            userId: input.userId,
            redirectUri: input.redirectUri,
            codeChallenge: input.codeChallenge,
            codeChallengeMethod: input.codeChallengeMethod,
            scope: input.scope,
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
        })

        return { code }
    }
}
