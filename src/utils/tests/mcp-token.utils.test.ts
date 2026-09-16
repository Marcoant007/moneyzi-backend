import { describe, it, expect } from 'vitest'
import { generateMcpToken, hashMcpToken } from '@/utils/mcp-token.utils'

describe('mcp-token.utils', () => {
    it('generateMcpToken returns a long random hex string, different every call', () => {
        const a = generateMcpToken()
        const b = generateMcpToken()

        expect(a).toMatch(/^[0-9a-f]{64}$/)
        expect(b).toMatch(/^[0-9a-f]{64}$/)
        expect(a).not.toBe(b)
    })

    it('hashMcpToken is deterministic and produces a sha256 hex digest', () => {
        const token = 'some-fixed-token-value'

        expect(hashMcpToken(token)).toBe(hashMcpToken(token))
        expect(hashMcpToken(token)).toMatch(/^[0-9a-f]{64}$/)
    })

    it('hashMcpToken produces different hashes for different tokens', () => {
        expect(hashMcpToken('token-a')).not.toBe(hashMcpToken('token-b'))
    })
})
