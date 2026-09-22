import { describe, it, expect, vi } from 'vitest'
import { ExchangeAuthorizationCodeUseCase, OAuthTokenExchangeError } from '@/application/use-cases/oauth-use-case/exchange-authorization-code.use-case'
import { hashAuthorizationCode } from '@/utils/oauth.utils'

function buildClientRepository() {
    return { create: vi.fn(), findById: vi.fn() }
}

function buildCodeRepository() {
    return { create: vi.fn(), findByCodeHash: vi.fn(), markUsed: vi.fn() }
}

function buildCreateMcpTokenUseCase() {
    return { execute: vi.fn() }
}

// Vetor de teste do RFC 7636 Apêndice B (mesmo par usado em oauth.utils.test.ts).
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

const baseClient = {
    id: 'client-1',
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/connector/oauth/abc'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
}

const baseInput = {
    clientId: 'client-1',
    code: 'raw-code-value',
    redirectUri: 'https://chatgpt.com/connector/oauth/abc',
    codeVerifier: VERIFIER,
}

function baseRecord(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 'code-1',
        clientId: 'client-1',
        userId: 'user-1',
        redirectUri: 'https://chatgpt.com/connector/oauth/abc',
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        scope: 'read',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        ...overrides,
    }
}

describe('ExchangeAuthorizationCodeUseCase', () => {
    it('rejects an unknown client_id (invalid_client)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(null)
        const codeRepository = buildCodeRepository()
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error).toBeInstanceOf(OAuthTokenExchangeError)
        expect(error.oauthErrorCode).toBe('invalid_client')
        expect(codeRepository.findByCodeHash).not.toHaveBeenCalled()
    })

    it('rejects when the code is not found (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(null)
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error).toBeInstanceOf(OAuthTokenExchangeError)
        expect(error.oauthErrorCode).toBe('invalid_grant')
        expect(codeRepository.findByCodeHash).toHaveBeenCalledWith(hashAuthorizationCode('raw-code-value'))
    })

    it('rejects when the code belongs to a different client (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord({ clientId: 'some-other-client' }))
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error.oauthErrorCode).toBe('invalid_grant')
    })

    it('rejects an already-used code (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord({ usedAt: new Date() }))
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error.oauthErrorCode).toBe('invalid_grant')
        expect(codeRepository.markUsed).not.toHaveBeenCalled()
    })

    it('rejects an expired code (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord({ expiresAt: new Date(Date.now() - 1000) }))
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error.oauthErrorCode).toBe('invalid_grant')
        expect(codeRepository.markUsed).not.toHaveBeenCalled()
    })

    it('rejects a redirect_uri that does not match the one stored on the code (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord({ redirectUri: 'https://chatgpt.com/connector/oauth/OTHER' }))
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error.oauthErrorCode).toBe('invalid_grant')
        expect(codeRepository.markUsed).not.toHaveBeenCalled()
    })

    it('rejects an invalid PKCE code_verifier (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord())
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute({ ...baseInput, codeVerifier: 'wrong-verifier' }).catch((e) => e)

        expect(error.oauthErrorCode).toBe('invalid_grant')
        expect(codeRepository.markUsed).not.toHaveBeenCalled()
    })

    it('rejects on a race where another exchange already consumed the code (invalid_grant)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord())
        codeRepository.markUsed.mockResolvedValue(false)
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const error = await useCase.execute(baseInput).catch((e) => e)

        expect(error.oauthErrorCode).toBe('invalid_grant')
        expect(createMcpTokenUseCase.execute).not.toHaveBeenCalled()
    })

    it('happy path: marks the code used, mints an McpToken labeled as chatgpt, and returns a bearer token response', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.findByCodeHash.mockResolvedValue(baseRecord({ scope: 'read_write' }))
        codeRepository.markUsed.mockResolvedValue(true)
        const createMcpTokenUseCase = buildCreateMcpTokenUseCase()
        createMcpTokenUseCase.execute.mockResolvedValue({ id: 'token-1', token: 'a'.repeat(64) })
        const useCase = new ExchangeAuthorizationCodeUseCase(codeRepository, clientRepository, createMcpTokenUseCase as any)

        const result = await useCase.execute(baseInput)

        expect(codeRepository.markUsed).toHaveBeenCalledWith('code-1')
        expect(createMcpTokenUseCase.execute).toHaveBeenCalledWith('user-1', 'ChatGPT', 'chatgpt', 'read_write')
        expect(result).toEqual({
            access_token: 'a'.repeat(64),
            token_type: 'bearer',
            scope: 'read_write',
        })
    })
})
