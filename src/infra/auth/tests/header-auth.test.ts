import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import headerAuth from '@/infra/auth/header-auth'

describe('headerAuth', () => {
    beforeEach(() => {
        delete process.env.MONEYZI_APP_KEY
    })

    afterEach(() => {
        delete process.env.MONEYZI_APP_KEY
    })

    it('returns 401 when x-user-id header is missing', async () => {
        let hook: any
        const app = {
            addHook: (evt: string, fn: any) => {
                hook = fn
            },
        } as any

        await headerAuth(app)

        const req = { headers: {} } as any
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as any

        await hook(req, reply)

        expect(reply.status).toHaveBeenCalledWith(401)
        expect(reply.send).toHaveBeenCalledWith({ error: 'Missing x-user-id header' })
    })

    it('returns 403 when configured api key is present and provided key mismatches', async () => {
        process.env.MONEYZI_APP_KEY = 'secret'

        let hook: any
        const app = {
            addHook: (evt: string, fn: any) => {
                hook = fn
            },
        } as any

        await headerAuth(app)

        const req = { headers: { 'x-user-id': 'u1', 'x-api-key': 'wrong' } } as any
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as any

        await hook(req, reply)

        expect(reply.status).toHaveBeenCalledWith(403)
        expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid api key' })
    })

    it('does not call reply when headers are valid and api key matches', async () => {
        process.env.MONEYZI_APP_KEY = 'secret'

        let hook: any
        const app = {
            addHook: (evt: string, fn: any) => {
                hook = fn
            },
        } as any

        await headerAuth(app)

        const req = { headers: { 'x-user-id': 'u1', 'x-api-key': 'secret' } } as any
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as any

        await hook(req, reply)

        expect(reply.status).not.toHaveBeenCalled()
        expect(reply.send).not.toHaveBeenCalled()
    })

    it('does not check api key when MONEYZI_APP_KEY is not configured', async () => {
        delete process.env.MONEYZI_APP_KEY

        let hook: any
        const app = {
            addHook: (evt: string, fn: any) => {
                hook = fn
            },
        } as any

        await headerAuth(app)

        const req = { headers: { 'x-user-id': 'u1' } } as any
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as any

        await hook(req, reply)

        expect(reply.status).not.toHaveBeenCalled()
        expect(reply.send).not.toHaveBeenCalled()
    })
})
