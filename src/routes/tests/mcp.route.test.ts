import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { hashMcpToken } from '@/utils/mcp-token.utils'

/**
 * Rota /mcp de verdade (Fastify + auth por bearer + SDK MCP), sem rede e sem banco:
 * só o repositório de tokens e o Redis são substituídos. Prova o wiring do
 * mcp.route.ts — que o escopo do token chega até a montagem das tools.
 */

const tokens = new Map<string, { id: string; userId: string; scope: string }>()

vi.mock('@/infra/repositories/prisma/prisma-mcp-token-repository', () => ({
    PrismaMcpTokenRepository: vi.fn().mockImplementation(function (this: unknown) {
        return {
            findActiveByTokenHash: vi.fn(async (hash: string) => tokens.get(hash) ?? null),
            touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
        }
    }),
}))

vi.mock('@/infra/cache/redis', () => ({
    redis: { set: vi.fn(), get: vi.fn().mockResolvedValue(null) },
}))

vi.mock('@/lib/prisma', () => ({
    // Qualquer acesso real ao banco nestes testes é um bug: explode alto.
    prisma: new Proxy({}, { get: (_t, prop) => { throw new Error(`o banco não deveria ser acessado (prisma.${String(prop)})`) } }),
}))

const NEW_TOOLS = ['merge_categories', 'rename_category', 'move_category', 'delete_category']

type App = ReturnType<typeof Fastify>

async function rpc(app: App, token: string | null, method: string, params: Record<string, unknown> = {}) {
    const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        payload: { jsonrpc: '2.0', id: 1, method, params },
    })
    return response
}

function parseBody(body: string) {
    const dataLine = body.split('\n').find((line) => line.startsWith('data:'))
    return JSON.parse(dataLine ? dataLine.slice(5).trim() : body)
}

describe('POST /mcp — scope reaches the tool registry', () => {
    let app: App

    // O import da rota carrega a árvore inteira de use cases (vários segundos com a
    // suíte rodando em paralelo): paga uma vez aqui, com folga, e não dentro de um `it`.
    beforeAll(async () => {
        const { mcpRoutes } = await import('../mcp.route')
        app = Fastify()
        await app.register(mcpRoutes)
        await app.ready()
    }, 60_000)

    afterAll(async () => {
        await app.close()
    })

    beforeEach(() => {
        tokens.clear()
        tokens.set(hashMcpToken('read-token'), { id: 't1', userId: 'user-1', scope: 'read' })
        tokens.set(hashMcpToken('write-token'), { id: 't2', userId: 'user-1', scope: 'read_write' })
    })

    it('rejects a request without a valid bearer token', async () => {
        expect((await rpc(app, null, 'tools/list')).statusCode).toBe(401)
        expect((await rpc(app, 'nope', 'tools/list')).statusCode).toBe(401)
    })

    it('a read token sees only the 6 read tools — none of the new write tools', async () => {
        const response = await rpc(app, 'read-token', 'tools/list')
        const names = parseBody(response.body).result.tools.map((t: any) => t.name)

        expect(response.statusCode).toBe(200)
        expect(names).toHaveLength(6)
        for (const name of NEW_TOOLS) expect(names).not.toContain(name)
    })

    it('a read_write token sees all 15 tools, the four new ones included', async () => {
        const response = await rpc(app, 'write-token', 'tools/list')
        const names = parseBody(response.body).result.tools.map((t: any) => t.name)

        expect(names).toHaveLength(15)
        expect(names).toEqual(expect.arrayContaining(['create_category', 'create_transaction', 'move_transaction_category', 'bulk_move_transactions', 'rollback_operation', ...NEW_TOOLS]))
    })

    it('a read token cannot call a new write tool by its exact name — and never reaches the database', async () => {
        for (const [name, args] of [
            ['merge_categories', { sourceId: 'a', targetId: 'b' }],
            ['rename_category', { categoryId: 'a', newName: 'x' }],
            ['move_category', { categoryId: 'a', newParentId: null }],
            ['delete_category', { categoryId: 'a' }],
        ] as const) {
            const body = parseBody((await rpc(app, 'read-token', 'tools/call', { name, arguments: args })).body)
            const rejected = body.error !== undefined || body.result?.isError === true
            expect(rejected, `${name} must be rejected for a read token`).toBe(true)
            // se a tool tivesse sido executada, o Proxy do prisma teria explodido com esta mensagem
            expect(JSON.stringify(body)).not.toContain('o banco não deveria ser acessado')
        }
    })

    it('the new tool descriptions are served in pt-BR, with the two-call warning on merge_categories', async () => {
        const body = parseBody((await rpc(app, 'write-token', 'tools/list')).body)
        const merge = body.result.tools.find((t: any) => t.name === 'merge_categories')

        expect(merge.description).toContain('ESTA FERRAMENTA EXIGE DUAS CHAMADAS')
        expect(merge.description).toContain('confirmationToken')
    })
})
