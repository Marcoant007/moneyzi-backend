import { describe, it, expect } from 'vitest'
import { generateOAuthClientId, generateAuthorizationCode, hashAuthorizationCode, verifyPkceS256 } from '@/utils/oauth.utils'

describe('oauth.utils', () => {
    it('generateOAuthClientId returns a long random hex string, different every call', () => {
        const a = generateOAuthClientId()
        const b = generateOAuthClientId()

        expect(a).toMatch(/^[0-9a-f]{64}$/)
        expect(b).toMatch(/^[0-9a-f]{64}$/)
        expect(a).not.toBe(b)
    })

    it('generateAuthorizationCode returns a long random hex string, different every call', () => {
        const a = generateAuthorizationCode()
        const b = generateAuthorizationCode()

        expect(a).toMatch(/^[0-9a-f]{64}$/)
        expect(b).toMatch(/^[0-9a-f]{64}$/)
        expect(a).not.toBe(b)
    })

    it('hashAuthorizationCode is deterministic and produces a sha256 hex digest', () => {
        const code = 'some-fixed-code-value'

        expect(hashAuthorizationCode(code)).toBe(hashAuthorizationCode(code))
        expect(hashAuthorizationCode(code)).toMatch(/^[0-9a-f]{64}$/)
    })

    describe('verifyPkceS256', () => {
        // Vetor de teste oficial do RFC 7636 Apêndice B — conferido computacionalmente
        // (sha256+base64url do verifier bate com o challenge do exemplo da spec).
        const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
        const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

        it('accepts the correct verifier/challenge pair (RFC 7636 Appendix B vector)', () => {
            expect(verifyPkceS256(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true)
        })

        it('rejects a verifier that does not match the stored challenge', () => {
            expect(verifyPkceS256('wrong-verifier', RFC_CHALLENGE)).toBe(false)
        })

        it('rejects the correct verifier against a different challenge', () => {
            expect(verifyPkceS256(RFC_VERIFIER, 'some-other-challenge')).toBe(false)
        })
    })
})
