import type { OAuthClient, OAuthClientRepository } from '@/application/repositories/oauth-client-repository'
import { prisma } from '@/lib/prisma'

const clientSelect = {
    id: true,
    clientName: true,
    redirectUris: true,
    tokenEndpointAuthMethod: true,
    grantTypes: true,
    responseTypes: true,
} as const

export class PrismaOAuthClientRepository implements OAuthClientRepository {
    async create(data: { clientName: string | null; redirectUris: string[] }): Promise<OAuthClient> {
        return prisma.oAuthClient.create({
            data: {
                clientName: data.clientName,
                redirectUris: data.redirectUris,
            },
            select: clientSelect,
        })
    }

    async findById(id: string): Promise<OAuthClient | null> {
        return prisma.oAuthClient.findUnique({
            where: { id },
            select: clientSelect,
        })
    }
}
