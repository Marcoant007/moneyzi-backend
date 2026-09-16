import type { ActiveMcpToken, McpTokenRepository, McpTokenSummary } from '@/application/repositories/mcp-token-repository'
import { prisma } from '@/lib/prisma'

const summarySelect = {
    id: true,
    name: true,
    client: true,
    scope: true,
    createdAt: true,
    lastUsedAt: true,
    revokedAt: true,
} as const

export class PrismaMcpTokenRepository implements McpTokenRepository {
    async create(data: { userId: string; name: string | null; client: string | null; scope: string; tokenHash: string }): Promise<McpTokenSummary> {
        return prisma.mcpToken.create({
            data: {
                userId: data.userId,
                name: data.name,
                client: data.client,
                scope: data.scope,
                tokenHash: data.tokenHash,
            },
            select: summarySelect,
        })
    }

    async findManyByUserId(userId: string): Promise<McpTokenSummary[]> {
        return prisma.mcpToken.findMany({
            where: { userId },
            select: summarySelect,
            orderBy: { createdAt: 'desc' },
        })
    }

    async findActiveByTokenHash(tokenHash: string): Promise<ActiveMcpToken | null> {
        const token = await prisma.mcpToken.findFirst({
            where: { tokenHash, revokedAt: null },
            select: { id: true, userId: true, scope: true },
        })
        return token
    }

    async touchLastUsedAt(id: string): Promise<void> {
        await prisma.mcpToken.update({
            where: { id },
            data: { lastUsedAt: new Date() },
        })
    }

    async revoke(id: string, userId: string): Promise<boolean> {
        const result = await prisma.mcpToken.updateMany({
            where: { id, userId, revokedAt: null },
            data: { revokedAt: new Date() },
        })
        return result.count > 0
    }

    async hardDeleteRevoked(id: string, userId: string): Promise<boolean> {
        const result = await prisma.mcpToken.deleteMany({
            where: { id, userId, revokedAt: { not: null } },
        })
        return result.count > 0
    }
}
