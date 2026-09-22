import { describe, it, expect, vi } from 'vitest'
import { RegisterOAuthClientUseCase, OAuthClientRegistrationError } from '@/application/use-cases/oauth-use-case/register-oauth-client.use-case'

function buildRepository() {
    return {
        create: vi.fn(),
        findById: vi.fn(),
    }
}

describe('RegisterOAuthClientUseCase', () => {
    it('rejects an empty redirect_uris list', async () => {
        const repository = buildRepository()
        const useCase = new RegisterOAuthClientUseCase(repository)

        await expect(useCase.execute({ redirectUris: [] })).rejects.toThrow(OAuthClientRegistrationError)
        expect(repository.create).not.toHaveBeenCalled()
    })

    it('rejects a non-https redirect_uri that is not localhost', async () => {
        const repository = buildRepository()
        const useCase = new RegisterOAuthClientUseCase(repository)

        await expect(
            useCase.execute({ redirectUris: ['http://evil.example.com/callback'] }),
        ).rejects.toThrow(OAuthClientRegistrationError)
        expect(repository.create).not.toHaveBeenCalled()
    })

    it('accepts a http://localhost redirect_uri (dev/native app loopback)', async () => {
        const repository = buildRepository()
        repository.create.mockResolvedValue({
            id: 'client-1',
            clientName: null,
            redirectUris: ['http://localhost:4000/callback'],
            tokenEndpointAuthMethod: 'none',
            grantTypes: ['authorization_code'],
            responseTypes: ['code'],
        })
        const useCase = new RegisterOAuthClientUseCase(repository)

        await expect(
            useCase.execute({ redirectUris: ['http://localhost:4000/callback'] }),
        ).resolves.toMatchObject({ id: 'client-1' })
    })

    it('rejects a token_endpoint_auth_method other than "none"', async () => {
        const repository = buildRepository()
        const useCase = new RegisterOAuthClientUseCase(repository)

        await expect(
            useCase.execute({
                redirectUris: ['https://chatgpt.com/connector/oauth/abc'],
                tokenEndpointAuthMethod: 'client_secret_basic',
            }),
        ).rejects.toThrow(OAuthClientRegistrationError)
        expect(repository.create).not.toHaveBeenCalled()
    })

    it('registers a valid public client and trims the client name', async () => {
        const repository = buildRepository()
        repository.create.mockImplementation(async (data: any) => ({
            id: 'client-1',
            clientName: data.clientName,
            redirectUris: data.redirectUris,
            tokenEndpointAuthMethod: 'none',
            grantTypes: ['authorization_code'],
            responseTypes: ['code'],
        }))
        const useCase = new RegisterOAuthClientUseCase(repository)

        const result = await useCase.execute({
            redirectUris: ['https://chatgpt.com/connector/oauth/abc'],
            clientName: '  ChatGPT  ',
        })

        expect(repository.create).toHaveBeenCalledWith({
            clientName: 'ChatGPT',
            redirectUris: ['https://chatgpt.com/connector/oauth/abc'],
        })
        expect(result.id).toBe('client-1')
    })
})
