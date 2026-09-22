export interface OAuthAuthorizationCodeRecord {
    id: string
    clientId: string
    userId: string
    redirectUri: string
    codeChallenge: string
    codeChallengeMethod: string
    scope: string
    expiresAt: Date
    usedAt: Date | null
}

export interface OAuthAuthorizationCodeRepository {
    create(data: {
        codeHash: string
        clientId: string
        userId: string
        redirectUri: string
        codeChallenge: string
        codeChallengeMethod: string
        scope: string
        expiresAt: Date
    }): Promise<OAuthAuthorizationCodeRecord>
    findByCodeHash(codeHash: string): Promise<OAuthAuthorizationCodeRecord | null>
    /** true só se marcou agora (usedAt ainda era null) — protege contra troca dupla do mesmo code. */
    markUsed(id: string): Promise<boolean>
}
