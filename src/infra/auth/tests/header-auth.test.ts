import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import headerAuth from '@/infra/auth/header-auth'

async function run(headers: Record<string, string>) {
    let hook: any
    const app = {
        addHook: (_evt: string, fn: any) => {
            hook = fn
        },
    } as any

    await headerAuth(app)

    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as any
    await hook({ headers }, reply)
    return reply
}

describe('headerAuth', () => {
    beforeEach(() => {
        process.env.MONEYZI_APP_KEY = 'secret'
    })

    afterEach(() => {
        delete process.env.MONEYZI_APP_KEY
    })

    it('rejects everything when MONEYZI_APP_KEY is not configured (fail-closed)', async () => {
        delete process.env.MONEYZI_APP_KEY

        const reply = await run({ 'x-user-id': 'u1', 'x-api-key': 'anything' })

        expect(reply.status).toHaveBeenCalledWith(503)
    })

    it('returns 403 when the api key is missing', async () => {
        const reply = await run({ 'x-user-id': 'u1' })

        expect(reply.status).toHaveBeenCalledWith(403)
        expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid api key' })
    })

    it('returns 403 when the api key mismatches', async () => {
        const reply = await run({ 'x-user-id': 'u1', 'x-api-key': 'wrong' })

        expect(reply.status).toHaveBeenCalledWith(403)
        expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid api key' })
    })

    it('returns 401 when x-user-id is missing even with a valid key', async () => {
        const reply = await run({ 'x-api-key': 'secret' })

        expect(reply.status).toHaveBeenCalledWith(401)
        expect(reply.send).toHaveBeenCalledWith({ error: 'Missing x-user-id header' })
    })

    it('does not call reply when the api key matches and x-user-id is present', async () => {
        const reply = await run({ 'x-user-id': 'u1', 'x-api-key': 'secret' })

        expect(reply.status).not.toHaveBeenCalled()
        expect(reply.send).not.toHaveBeenCalled()
    })
})
