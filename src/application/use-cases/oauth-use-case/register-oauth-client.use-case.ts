import type { OAuthClient, OAuthClientRepository } from '@/application/repositories/oauth-client-repository'

export class OAuthClientRegistrationError extends Error {
    constructor(message: string) {
        super(message)
    }
}

export interface RegisterOAuthClientInput {
    redirectUris: string[]
    clientName?: string
    tokenEndpointAuthMethod?: string
}

/**
 * DCR (RFC 7591) — client público apenas: v1 não emite client_secret, então
 * qualquer client que peça um método de auth diferente de "none" é rejeitado
 * de cara (não dá pra emitir o que ele pediu). `redirect_uris` precisa ser
 * https, exceto localhost (loopback), que RFC 8252 §8.3 trata como caso
 * especial legítimo pra apps nativos em desenvolvimento.
 */
export class RegisterOAuthClientUseCase {
    constructor(private readonly oauthClientRepository: OAuthClientRepository) {}

    async execute(input: RegisterOAuthClientInput): Promise<OAuthClient> {
        if (!input.redirectUris || input.redirectUris.length === 0) {
            throw new OAuthClientRegistrationError('redirect_uris is required and must be non-empty')
        }

        for (const uri of input.redirectUris) {
            let parsed: URL
            try {
                parsed = new URL(uri)
            } catch {
                throw new OAuthClientRegistrationError(`invalid redirect_uri: ${uri}`)
            }
            const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
            if (parsed.protocol !== 'https:' && !isLoopback) {
                throw new OAuthClientRegistrationError(`redirect_uri must be https (or localhost): ${uri}`)
            }
        }

        const authMethod = input.tokenEndpointAuthMethod ?? 'none'
        if (authMethod !== 'none') {
            throw new OAuthClientRegistrationError('only the "none" token_endpoint_auth_method (public client) is supported')
        }

        return this.oauthClientRepository.create({
            clientName: input.clientName?.trim() || null,
            redirectUris: input.redirectUris,
        })
    }
}
