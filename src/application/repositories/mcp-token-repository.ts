export interface McpTokenSummary {
    id: string
    name: string | null
    client: string | null
    createdAt: Date
    lastUsedAt: Date | null
    revokedAt: Date | null
}

export interface ActiveMcpToken {
    id: string
    userId: string
}

export interface McpTokenRepository {
    create(data: { userId: string; name: string | null; client: string | null; tokenHash: string }): Promise<McpTokenSummary>
    findManyByUserId(userId: string): Promise<McpTokenSummary[]>
    findActiveByTokenHash(tokenHash: string): Promise<ActiveMcpToken | null>
    touchLastUsedAt(id: string): Promise<void>
    revoke(id: string, userId: string): Promise<boolean>
    /** Só apaga de fato se o token já estiver revogado — proteção contra apagar um token ainda em uso. */
    hardDeleteRevoked(id: string, userId: string): Promise<boolean>
}
