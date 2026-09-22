import { randomBytes, createHash } from 'node:crypto'

/** RFC 7591 client_id — mesmo formato de tamanho do McpToken (32 bytes hex). */
export function generateOAuthClientId(): string {
    return randomBytes(32).toString('hex')
}

/** RFC 6749 §4.1.2 authorization code — nunca gravado cru, só o hash. */
export function generateAuthorizationCode(): string {
    return randomBytes(32).toString('hex')
}

export function hashAuthorizationCode(code: string): string {
    return createHash('sha256').update(code).digest('hex')
}

/**
 * RFC 7636 (PKCE) §4.6: code_challenge = BASE64URL-ENCODE(SHA256(code_verifier)).
 * Comparação em tempo constante não é necessária aqui — o challenge não é
 * segredo (viaja na URL de /authorize), só o verifier é, e esse nunca é
 * comparado contra um valor pré-computado guardado em texto puro.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
    const computed = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url')
    return computed === codeChallenge
}
