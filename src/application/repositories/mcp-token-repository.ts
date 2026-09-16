export interface McpTokenSummary {
    id: string
    name: string | null
    createdAt: Date
    lastUsedAt: Date | null
    revokedAt: Date | null
}

export interface ActiveMcpToken {
    id: string
    userId: string
}

export interface McpTokenRepository {
    create(data: { userId: string; name: string | null; tokenHash: string }): Promise<McpTokenSummary>
    findManyByUserId(userId: string): Promise<McpTokenSummary[]>
    findActiveByTokenHash(tokenHash: string): Promise<ActiveMcpToken | null>
    touchLastUsedAt(id: string): Promise<void>
    revoke(id: string, userId: string): Promise<boolean>
}
