import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { isUnsafeErrorMessage, registerErrorResponseSanitizer } from '@/infra/http/sanitize-error-responses'

async function buildApp() {
    const app = Fastify()
    registerErrorResponseSanitizer(app)
    app.get('/500', async (_req, reply) =>
        reply.status(500).send({ error: 'Invalid `prisma.transaction.update()` invocation: column "x" does not exist' }),
    )
    app.get('/400-domain', async (_req, reply) => reply.status(400).send({ error: 'Categoria com subcategorias não pode ser excluída' }))
    app.get('/400-prisma', async (_req, reply) =>
        reply.status(400).send({ error: 'Unique constraint failed on the fields: (`userId`,`name`) P2002' }),
    )
    app.get('/503', async (_req, reply) => reply.status(503).send({ error: 'Fila temporariamente indisponível.' }))
    app.get('/ok', async () => ({ message: 'Invalid `prisma` is fine on success' }))
    return app
}

describe('error response sanitizer', () => {
    it('replaces any 5xx body with a generic message', async () => {
        const app = await buildApp()
        const res = await app.inject({ url: '/500' })
        expect(res.statusCode).toBe(500)
        expect(res.json()).toEqual({ error: 'Internal error' })
    })

    it('keeps short business messages on 4xx', async () => {
        const app = await buildApp()
        const res = await app.inject({ url: '/400-domain' })
        expect(res.json()).toEqual({ error: 'Categoria com subcategorias não pode ser excluída' })
    })

    it('hides internal details on 4xx', async () => {
        const app = await buildApp()
        const res = await app.inject({ url: '/400-prisma' })
        expect(res.json()).toEqual({ error: 'Requisição inválida' })
    })

    it('keeps a safe public 503 message', async () => {
        const app = await buildApp()
        const res = await app.inject({ url: '/503' })
        expect(res.json()).toEqual({ error: 'Fila temporariamente indisponível.' })
    })

    it('never touches successful responses', async () => {
        const app = await buildApp()
        const res = await app.inject({ url: '/ok' })
        expect(res.json()).toEqual({ message: 'Invalid `prisma` is fine on success' })
    })

    it('flags stack traces and long messages', () => {
        expect(isUnsafeErrorMessage('Error\n    at foo (/app/src/x.ts:1:1)')).toBe(true)
        expect(isUnsafeErrorMessage('x'.repeat(301))).toBe(true)
        expect(isUnsafeErrorMessage('Cartão não encontrado')).toBe(false)
    })
})
