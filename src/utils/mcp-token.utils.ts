import { randomBytes, createHash } from 'node:crypto'

export function generateMcpToken(): string {
    return randomBytes(32).toString('hex')
}

export function hashMcpToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}
