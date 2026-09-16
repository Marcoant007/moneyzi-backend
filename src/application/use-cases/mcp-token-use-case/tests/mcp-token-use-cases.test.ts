import { describe, it, expect, vi } from 'vitest'
import { CreateMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/create-mcp-token.use-case'
import { ListMcpTokensUseCase } from '@/application/use-cases/mcp-token-use-case/list-mcp-tokens.use-case'
import { RevokeMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/revoke-mcp-token.use-case'
import { hashMcpToken } from '@/utils/mcp-token.utils'

function buildRepository() {
    return {
        create: vi.fn(),
        findManyByUserId: vi.fn(),
        findActiveByTokenHash: vi.fn(),
        touchLastUsedAt: vi.fn(),
        revoke: vi.fn(),
    }
}

describe('CreateMcpTokenUseCase', () => {
    it('stores only the hash and returns the raw token alongside the summary', async () => {
        const repository = buildRepository()
        repository.create.mockImplementation(async (data: any) => ({
            id: 'token-1',
            name: data.name,
            client: data.client,
            createdAt: new Date('2026-01-01'),
            lastUsedAt: null,
            revokedAt: null,
        }))

        const useCase = new CreateMcpTokenUseCase(repository)
        const result = await useCase.execute('user-1', 'ChatGPT', 'chatgpt')

        expect(repository.create).toHaveBeenCalledTimes(1)
        const callArg = repository.create.mock.calls[0][0]
        expect(callArg.userId).toBe('user-1')
        expect(callArg.name).toBe('ChatGPT')
        expect(callArg.client).toBe('chatgpt')
        expect(callArg.tokenHash).toBe(hashMcpToken(result.token))
        expect(callArg.tokenHash).not.toBe(result.token)
        expect(result.token).toMatch(/^[0-9a-f]{64}$/)
        expect(result.id).toBe('token-1')
    })

    it('normalizes a blank name to null', async () => {
        const repository = buildRepository()
        repository.create.mockResolvedValue({ id: 't', name: null, client: null, createdAt: new Date(), lastUsedAt: null, revokedAt: null })

        const useCase = new CreateMcpTokenUseCase(repository)
        await useCase.execute('user-1', '   ')

        expect(repository.create.mock.calls[0][0].name).toBeNull()
        expect(repository.create.mock.calls[0][0].client).toBeNull()
    })
})

describe('ListMcpTokensUseCase', () => {
    it('delegates to the repository scoped to the given userId', async () => {
        const repository = buildRepository()
        repository.findManyByUserId.mockResolvedValue([{ id: 't1' }])

        const useCase = new ListMcpTokensUseCase(repository)
        const result = await useCase.execute('user-1')

        expect(repository.findManyByUserId).toHaveBeenCalledWith('user-1')
        expect(result).toEqual([{ id: 't1' }])
    })
})

describe('RevokeMcpTokenUseCase', () => {
    it('delegates to the repository with both the token id and the owner userId', async () => {
        const repository = buildRepository()
        repository.revoke.mockResolvedValue(true)

        const useCase = new RevokeMcpTokenUseCase(repository)
        const result = await useCase.execute('token-1', 'user-1')

        expect(repository.revoke).toHaveBeenCalledWith('token-1', 'user-1')
        expect(result).toBe(true)
    })

    it('returns false when the repository could not find/own the token', async () => {
        const repository = buildRepository()
        repository.revoke.mockResolvedValue(false)

        const useCase = new RevokeMcpTokenUseCase(repository)
        const result = await useCase.execute('token-1', 'someone-else')

        expect(result).toBe(false)
    })
})
