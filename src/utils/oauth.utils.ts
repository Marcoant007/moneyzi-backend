import { randomBytes, createHash } from 'node:crypto'

export function generateOAuthClientId(): string {
    return randomBytes(32).toString('hex')
}

export function generateAuthorizationCode(): string {
    return randomBytes(32).toString('hex')
}

export function hashAuthorizationCode(code: string): string {
    return createHash('sha256').update(code).digest('hex')
}
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
    const computed = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url')
    return computed === codeChallenge
}

export type OAuthScope = 'read' | 'read_write'

export function normalizeOAuthScope(rawScope: string | undefined | null): OAuthScope {
    const tokens = (rawScope ?? '').split(/\s+/).filter(Boolean)
    return tokens.includes('read_write') ? 'read_write' : 'read'
}
