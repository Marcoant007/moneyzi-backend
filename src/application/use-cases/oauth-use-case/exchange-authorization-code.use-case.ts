import type { OAuthClientRepository } from '@/application/repositories/oauth-client-repository'
import type { OAuthAuthorizationCodeRepository } from '@/application/repositories/oauth-authorization-code-repository'
import type { CreateMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/create-mcp-token.use-case'
import { hashAuthorizationCode, verifyPkceS256 } from '@/utils/oauth.utils'

/**
 * Código de erro no formato que RFC 6749 §5.2 exige na resposta de
 * POST /oauth/token — o controller usa `oauthErrorCode` pra montar
 * `{ error, error_description }`, não `error.message` cru como o resto do
 * backend faz (única exceção deliberada: aqui o wire format é ditado pelo
 * RFC, não pela nossa convenção interna).
 */
export class OAuthTokenExchangeError extends Error {
    constructor(
        readonly oauthErrorCode: 'invalid_request' | 'invalid_client' | 'invalid_grant',
        message: string,
    ) {
        super(message)
    }
}

export interface ExchangeAuthorizationCodeInput {
    clientId: string
    code: string
    redirectUri: string
    codeVerifier: string
}

export interface ExchangeAuthorizationCodeResult {
    access_token: string
    token_type: 'bearer'
    scope: string
}

/**
 * Troca o code de uso único por um access_token — que É um McpToken normal
 * (reaproveita CreateMcpTokenUseCase), então mcp-bearer-auth.ts não precisa
 * de nenhuma lógica nova e o token aparece/pode ser revogado em Settings
 * como qualquer outro. Ordem de validação importa (replicada nos testes):
 * client desconhecido -> code não encontrado -> já usado -> expirado ->
 * redirect_uri não bate -> PKCE inválido -> markUsed atômico (corrida).
 */
export class ExchangeAuthorizationCodeUseCase {
    constructor(
        private readonly oauthAuthorizationCodeRepository: OAuthAuthorizationCodeRepository,
        private readonly oauthClientRepository: OAuthClientRepository,
        private readonly createMcpTokenUseCase: CreateMcpTokenUseCase,
    ) {}

    async execute(input: ExchangeAuthorizationCodeInput): Promise<ExchangeAuthorizationCodeResult> {
        const client = await this.oauthClientRepository.findById(input.clientId)
        if (!client) {
            throw new OAuthTokenExchangeError('invalid_client', 'unknown client_id')
        }

        const codeHash = hashAuthorizationCode(input.code)
        const record = await this.oauthAuthorizationCodeRepository.findByCodeHash(codeHash)
        if (!record || record.clientId !== client.id) {
            throw new OAuthTokenExchangeError('invalid_grant', 'authorization code not found')
        }

        if (record.usedAt) {
            throw new OAuthTokenExchangeError('invalid_grant', 'authorization code already used')
        }

        if (record.expiresAt.getTime() < Date.now()) {
            throw new OAuthTokenExchangeError('invalid_grant', 'authorization code expired')
        }

        if (record.redirectUri !== input.redirectUri) {
            throw new OAuthTokenExchangeError('invalid_grant', 'redirect_uri does not match the authorization request')
        }

        if (!verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
            throw new OAuthTokenExchangeError('invalid_grant', 'code_verifier does not match the code_challenge')
        }

        const marked = await this.oauthAuthorizationCodeRepository.markUsed(record.id)
        if (!marked) {
            // Corrida: outra troca concorrente já consumiu o code entre o find e o markUsed.
            throw new OAuthTokenExchangeError('invalid_grant', 'authorization code already used')
        }

        const minted = await this.createMcpTokenUseCase.execute(
            record.userId,
            client.clientName ?? 'ChatGPT (OAuth)',
            'chatgpt',
            record.scope,
        )

        return {
            access_token: minted.token,
            token_type: 'bearer',
            scope: record.scope,
        }
    }
}
