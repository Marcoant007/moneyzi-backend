import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { RegisterOAuthClientUseCase, OAuthClientRegistrationError } from '@/application/use-cases/oauth-use-case/register-oauth-client.use-case'
import { FindOAuthClientByIdUseCase } from '@/application/use-cases/oauth-use-case/find-oauth-client-by-id.use-case'
import { ExchangeAuthorizationCodeUseCase, OAuthTokenExchangeError } from '@/application/use-cases/oauth-use-case/exchange-authorization-code.use-case'
import { normalizeOAuthScope } from '@/utils/oauth.utils'

const registerBodySchema = z.object({
    redirect_uris: z.array(z.string()).min(1),
    client_name: z.string().optional(),
    token_endpoint_auth_method: z.string().optional(),
})

const authorizeQuerySchema = z.object({
    response_type: z.string().optional(),
    client_id: z.string().min(1),
    redirect_uri: z.string().min(1),
    state: z.string().optional(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.string().optional(),
    scope: z.string().optional(),
})

const tokenBodySchema = z.object({
    grant_type: z.string(),
    code: z.string().min(1),
    redirect_uri: z.string().min(1),
    client_id: z.string().min(1),
    code_verifier: z.string().min(1),
})


export class OAuthController {
    constructor(
        private readonly registerOAuthClientUseCase: RegisterOAuthClientUseCase,
        private readonly findOAuthClientByIdUseCase: FindOAuthClientByIdUseCase,
        private readonly exchangeAuthorizationCodeUseCase: ExchangeAuthorizationCodeUseCase,
        private readonly issuerUrl: string,
        private readonly frontendUrl: string,
    ) { }

    private get authorizationServerMetadata() {
        return {
            issuer: this.issuerUrl,
            authorization_endpoint: `${this.issuerUrl}/oauth/authorize`,
            token_endpoint: `${this.issuerUrl}/oauth/token`,
            registration_endpoint: `${this.issuerUrl}/oauth/register`,
            scopes_supported: ['read', 'read_write'],
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
        }
    }

    async authorizationServerMetadataHandler(_request: FastifyRequest, reply: FastifyReply) {
        return reply.send(this.authorizationServerMetadata)
    }

    async protectedResourceMetadataHandler(_request: FastifyRequest, reply: FastifyReply) {
        return reply.send({
            resource: `${this.issuerUrl}/mcp`,
            authorization_servers: [this.issuerUrl],
        })
    }

    async register(request: FastifyRequest, reply: FastifyReply) {
        try {
            const body = registerBodySchema.parse(request.body ?? {})
            const client = await this.registerOAuthClientUseCase.execute({
                redirectUris: body.redirect_uris,
                clientName: body.client_name,
                tokenEndpointAuthMethod: body.token_endpoint_auth_method,
            })

            return reply.status(201).send({
                client_id: client.id,
                client_id_issued_at: Math.floor(Date.now() / 1000),
                client_name: client.clientName,
                redirect_uris: client.redirectUris,
                token_endpoint_auth_method: client.tokenEndpointAuthMethod,
                grant_types: client.grantTypes,
                response_types: client.responseTypes,
            })
        } catch (error) {
            if (error instanceof OAuthClientRegistrationError) {
                return reply.status(400).send({ error: 'invalid_client_metadata', error_description: error.message })
            }
            if (error instanceof z.ZodError) {
                return reply.status(400).send({ error: 'invalid_client_metadata', error_description: error.message })
            }
            console.error(error)
            return reply.status(500).send({ error: 'server_error' })
        }
    }

    async authorize(request: FastifyRequest, reply: FastifyReply) {
        const parsedQuery = authorizeQuerySchema.safeParse(request.query ?? {})
        if (!parsedQuery.success) {
            return reply.status(400).send({ error: 'invalid_request', error_description: parsedQuery.error.message })
        }
        const query = parsedQuery.data

        const client = await this.findOAuthClientByIdUseCase.execute(query.client_id)
        if (!client) {
            return reply.status(400).send({ error: 'invalid_request', error_description: 'unknown client_id' })
        }
        if (!client.redirectUris.includes(query.redirect_uri)) {
            return reply.status(400).send({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' })
        }

        const redirectWithError = (errorCode: string, description: string) => {
            const url = new URL(query.redirect_uri)
            url.searchParams.set('error', errorCode)
            url.searchParams.set('error_description', description)
            if (query.state) url.searchParams.set('state', query.state)
            return reply.redirect(url.toString(), 302)
        }

        if (query.response_type && query.response_type !== 'code') {
            return redirectWithError('unsupported_response_type', 'only response_type=code is supported')
        }
        if (!query.code_challenge || query.code_challenge_method !== 'S256') {
            return redirectWithError('invalid_request', 'code_challenge with code_challenge_method=S256 is required (PKCE)')
        }

        const consentUrl = new URL('/oauth/consent', this.frontendUrl)
        consentUrl.searchParams.set('client_id', client.id)
        if (client.clientName) consentUrl.searchParams.set('client_name', client.clientName)
        consentUrl.searchParams.set('redirect_uri', query.redirect_uri)
        consentUrl.searchParams.set('code_challenge', query.code_challenge)
        consentUrl.searchParams.set('code_challenge_method', query.code_challenge_method)
        consentUrl.searchParams.set('scope', normalizeOAuthScope(query.scope))
        if (query.state) consentUrl.searchParams.set('state', query.state)

        return reply.redirect(consentUrl.toString(), 302)
    }

    async token(request: FastifyRequest, reply: FastifyReply) {
        const parsedBody = tokenBodySchema.safeParse(request.body ?? {})
        if (!parsedBody.success) {
            return reply.status(400).send({ error: 'invalid_request', error_description: parsedBody.error.message })
        }
        const body = parsedBody.data

        if (body.grant_type !== 'authorization_code') {
            return reply.status(400).send({ error: 'unsupported_grant_type' })
        }

        try {
            const result = await this.exchangeAuthorizationCodeUseCase.execute({
                clientId: body.client_id,
                code: body.code,
                redirectUri: body.redirect_uri,
                codeVerifier: body.code_verifier,
            })
            return reply.status(200).send(result)
        } catch (error) {
            if (error instanceof OAuthTokenExchangeError) {
                const status = error.oauthErrorCode === 'invalid_client' ? 401 : 400
                return reply.status(status).send({ error: error.oauthErrorCode, error_description: error.message })
            }
            console.error(error)
            return reply.status(500).send({ error: 'server_error' })
        }
    }
}
