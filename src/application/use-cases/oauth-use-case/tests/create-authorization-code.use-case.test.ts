import { describe, it, expect, vi } from 'vitest'
import { CreateAuthorizationCodeUseCase, CreateAuthorizationCodeError } from '@/application/use-cases/oauth-use-case/create-authorization-code.use-case'
import { hashAuthorizationCode } from '@/utils/oauth.utils'

function buildClientRepository() {
    return { create: vi.fn(), findById: vi.fn() }
}

function buildCodeRepository() {
    return { create: vi.fn(), findByCodeHash: vi.fn(), markUsed: vi.fn() }
}

const baseClient = {
    id: 'client-1',
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/connector/oauth/abc'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
}

describe('CreateAuthorizationCodeUseCase', () => {
    it('rejects an unknown client_id', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(null)
        const codeRepository = buildCodeRepository()
        const useCase = new CreateAuthorizationCodeUseCase(clientRepository, codeRepository)

        await expect(
            useCase.execute({
                userId: 'user-1',
                clientId: 'unknown-client',
                redirectUri: 'https://chatgpt.com/connector/oauth/abc',
                codeChallenge: 'challenge',
                codeChallengeMethod: 'S256',
                scope: 'read',
            }),
        ).rejects.toThrow(CreateAuthorizationCodeError)
        expect(codeRepository.create).not.toHaveBeenCalled()
    })

    it('rejects a redirect_uri not registered for the client', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        const useCase = new CreateAuthorizationCodeUseCase(clientRepository, codeRepository)

        await expect(
            useCase.execute({
                userId: 'user-1',
                clientId: 'client-1',
                redirectUri: 'https://attacker.example.com/callback',
                codeChallenge: 'challenge',
                codeChallengeMethod: 'S256',
                scope: 'read',
            }),
        ).rejects.toThrow(CreateAuthorizationCodeError)
        expect(codeRepository.create).not.toHaveBeenCalled()
    })

    it('rejects a code_challenge_method other than S256', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        const useCase = new CreateAuthorizationCodeUseCase(clientRepository, codeRepository)

        await expect(
            useCase.execute({
                userId: 'user-1',
                clientId: 'client-1',
                redirectUri: 'https://chatgpt.com/connector/oauth/abc',
                codeChallenge: 'challenge',
                codeChallengeMethod: 'plain',
                scope: 'read',
            }),
        ).rejects.toThrow(CreateAuthorizationCodeError)
        expect(codeRepository.create).not.toHaveBeenCalled()
    })

    it('stores only the code hash and returns the raw code, expiring ~10 minutes out', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.create.mockImplementation(async (data: any) => ({ id: 'code-1', ...data }))
        const useCase = new CreateAuthorizationCodeUseCase(clientRepository, codeRepository)

        const before = Date.now()
        const result = await useCase.execute({
            userId: 'user-1',
            clientId: 'client-1',
            redirectUri: 'https://chatgpt.com/connector/oauth/abc',
            codeChallenge: 'challenge-xyz',
            codeChallengeMethod: 'S256',
            scope: 'read_write',
        })
        const after = Date.now()

        expect(result.code).toMatch(/^[0-9a-f]{64}$/)
        expect(codeRepository.create).toHaveBeenCalledTimes(1)
        const callArg = codeRepository.create.mock.calls[0][0]
        expect(callArg.codeHash).toBe(hashAuthorizationCode(result.code))
        expect(callArg.codeHash).not.toBe(result.code)
        expect(callArg.userId).toBe('user-1')
        expect(callArg.clientId).toBe('client-1')
        expect(callArg.scope).toBe('read_write')

        const ttlMs = callArg.expiresAt.getTime() - before
        expect(ttlMs).toBeGreaterThan(9 * 60 * 1000)
        expect(callArg.expiresAt.getTime()).toBeLessThanOrEqual(after + 10 * 60 * 1000)
    })

    it('normalizes a raw space-separated OAuth scope list before storing it (regression: write tools silently disappeared because McpToken.scope ended up as "read read_write", which never matches the exact "read_write" check in mcp-tools.ts)', async () => {
        const clientRepository = buildClientRepository()
        clientRepository.findById.mockResolvedValue(baseClient)
        const codeRepository = buildCodeRepository()
        codeRepository.create.mockImplementation(async (data: any) => ({ id: 'code-1', ...data }))
        const useCase = new CreateAuthorizationCodeUseCase(clientRepository, codeRepository)

        await useCase.execute({
            userId: 'user-1',
            clientId: 'client-1',
            redirectUri: 'https://chatgpt.com/connector/oauth/abc',
            codeChallenge: 'challenge-xyz',
            codeChallengeMethod: 'S256',
            scope: 'read read_write',
        })

        expect(codeRepository.create.mock.calls[0][0].scope).toBe('read_write')
    })
})
