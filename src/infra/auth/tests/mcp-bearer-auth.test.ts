import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashMcpToken } from '@/utils/mcp-token.utils'

const findActiveByTokenHashMock = vi.fn()
const touchLastUsedAtMock = vi.fn()

vi.mock('@/infra/repositories/prisma/prisma-mcp-token-repository', () => ({
    PrismaMcpTokenRepository: vi.fn().mockImplementation(function (this: unknown) {
        return {
            findActiveByTokenHash: findActiveByTokenHashMock,
            touchLastUsedAt: touchLastUsedAtMock,
        }
    }),
}))

function buildApp() {
    let hook: any
    const app = {
        addHook: (evt: string, fn: any) => {
            hook = fn
        },
    } as any
    return { app, getHook: () => hook }
}

function buildReply() {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
    } as any
}

describe('mcpBearerAuth', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        touchLastUsedAtMock.mockResolvedValue(undefined)
    })

    it('returns 401 when the Authorization header is missing', async () => {
        const { default: mcpBearerAuth } = await import('@/infra/auth/mcp-bearer-auth')
        const { app, getHook } = buildApp()
        await mcpBearerAuth(app)

        const req = { headers: {} } as any
        const reply = buildReply()

        await getHook()(req, reply)

        expect(reply.status).toHaveBeenCalledWith(401)
        expect(reply.header).toHaveBeenCalledWith(
            'WWW-Authenticate',
            expect.stringContaining('resource_metadata='),
        )
        expect(findActiveByTokenHashMock).not.toHaveBeenCalled()
    })

    it('returns 401 when no active token matches the hash', async () => {
        findActiveByTokenHashMock.mockResolvedValue(null)
        const { default: mcpBearerAuth } = await import('@/infra/auth/mcp-bearer-auth')
        const { app, getHook } = buildApp()
        await mcpBearerAuth(app)

        const req = { headers: { authorization: 'Bearer unknown-or-revoked' } } as any
        const reply = buildReply()

        await getHook()(req, reply)

        expect(reply.status).toHaveBeenCalledWith(401)
        expect(reply.header).toHaveBeenCalledWith(
            'WWW-Authenticate',
            expect.stringContaining('resource_metadata='),
        )
        expect(findActiveByTokenHashMock).toHaveBeenCalledWith(hashMcpToken('unknown-or-revoked'))
    })

    it('resolves req.mcpUserId and touches lastUsedAt when the token is active', async () => {
        findActiveByTokenHashMock.mockResolvedValue({ id: 'token-1', userId: 'user-42' })
        const { default: mcpBearerAuth } = await import('@/infra/auth/mcp-bearer-auth')
        const { app, getHook } = buildApp()
        await mcpBearerAuth(app)

        const req = { headers: { authorization: 'Bearer valid-token' } } as any
        const reply = buildReply()

        await getHook()(req, reply)

        expect(reply.status).not.toHaveBeenCalled()
        expect(reply.send).not.toHaveBeenCalled()
        expect(req.mcpUserId).toBe('user-42')
        expect(touchLastUsedAtMock).toHaveBeenCalledWith('token-1')
    })
})
