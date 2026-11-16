import type { FastifyInstance } from 'fastify'

// Padrões de mensagem que nunca devem chegar ao cliente: erros do Prisma
// (citam tabelas/colunas/queries), stack traces, conexões e caminhos internos.
const INTERNAL_PATTERNS = [
    /prisma/i,
    /invalid `/i,
    /\bat \S+ \(/, // linha de stack trace
    /\n\s+at /,
    /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/,
    /\b(column|relation|constraint|violates|foreign key|unique constraint|syntax error)\b/i,
    /node_modules|[A-Z]:\\|\/(?:app|src|usr|home)\//,
    /\bP\d{4}\b/, // códigos de erro do Prisma (P2002...)
]

const MAX_SAFE_LENGTH = 300

export function isUnsafeErrorMessage(message: string): boolean {
    return message.length > MAX_SAFE_LENGTH || INTERNAL_PATTERNS.some((re) => re.test(message))
}

function sanitizeBody(statusCode: number, body: unknown): { body: unknown; changed: boolean } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { body, changed: false }
    const record = body as Record<string, unknown>

    if (statusCode >= 500) {
        const safe: Record<string, unknown> = { error: 'Internal error' }
        // Mantém o que é deliberadamente público (ex.: mensagem de fila indisponível no 503).
        if (statusCode === 503 && typeof record.error === 'string' && !isUnsafeErrorMessage(record.error)) {
            safe.error = record.error
        }
        const changed = JSON.stringify(safe) !== JSON.stringify(record)
        return { body: safe, changed }
    }

    let changed = false
    const copy: Record<string, unknown> = { ...record }
    for (const key of ['error', 'message', 'error_description']) {
        const value = copy[key]
        if (typeof value === 'string' && isUnsafeErrorMessage(value)) {
            copy[key] = key === 'error_description' ? 'Request could not be processed' : 'Requisição inválida'
            changed = true
        }
    }
    return { body: copy, changed }
}

/**
 * Rede de segurança central: muitos controllers respondem `error.message` cru.
 * Erros de negócio (curtos, em português) continuam passando; detalhes
 * internos são trocados por mensagem genérica e vão só para o log.
 */
export function registerErrorResponseSanitizer(app: FastifyInstance) {
    app.addHook('onSend', async (request, reply, payload) => {
        if (reply.statusCode < 400 || typeof payload !== 'string') return payload
        const contentType = String(reply.getHeader('content-type') ?? '')
        if (!contentType.includes('application/json')) return payload

        let parsed: unknown
        try {
            parsed = JSON.parse(payload)
        } catch {
            return payload
        }

        const { body, changed } = sanitizeBody(reply.statusCode, parsed)
        if (!changed) return payload

        request.log.error({ statusCode: reply.statusCode, url: request.url, original: parsed }, 'Erro interno ocultado da resposta')
        return JSON.stringify(body)
    })
}
