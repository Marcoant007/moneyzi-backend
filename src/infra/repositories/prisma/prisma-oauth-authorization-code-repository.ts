import type {
    OAuthAuthorizationCodeRecord,
    OAuthAuthorizationCodeRepository,
} from '@/application/repositories/oauth-authorization-code-repository'
import { prisma } from '@/lib/prisma'

const recordSelect = {
    id: true,
    clientId: true,
    userId: true,
    redirectUri: true,
    codeChallenge: true,
    codeChallengeMethod: true,
    scope: true,
    expiresAt: true,
    usedAt: true,
} as const

export class PrismaOAuthAuthorizationCodeRepository implements OAuthAuthorizationCodeRepository {
    async create(data: {
        codeHash: string
        clientId: string
        userId: string
        redirectUri: string
        codeChallenge: string
        codeChallengeMethod: string
        scope: string
        expiresAt: Date
    }): Promise<OAuthAuthorizationCodeRecord> {
        return prisma.oAuthAuthorizationCode.create({
            data,
            select: recordSelect,
        })
    }

    async findByCodeHash(codeHash: string): Promise<OAuthAuthorizationCodeRecord | null> {
        return prisma.oAuthAuthorizationCode.findUnique({
            where: { codeHash },
            select: recordSelect,
        })
    }

    async markUsed(id: string): Promise<boolean> {
        const result = await prisma.oAuthAuthorizationCode.updateMany({
            where: { id, usedAt: null },
            data: { usedAt: new Date() },
        })
        return result.count > 0
    }
}
