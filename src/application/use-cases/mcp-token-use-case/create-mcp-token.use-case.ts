import type { McpTokenRepository } from '@/application/repositories/mcp-token-repository'
import { generateMcpToken, hashMcpToken } from '@/utils/mcp-token.utils'

export class CreateMcpTokenUseCase {
    constructor(private readonly mcpTokenRepository: McpTokenRepository) {}

    async execute(userId: string, name?: string, client?: string, scope: string = 'read') {
        const token = generateMcpToken()
        const tokenHash = hashMcpToken(token)

        const summary = await this.mcpTokenRepository.create({
            userId,
            name: name?.trim() || null,
            client: client?.trim() || null,
            scope,
            tokenHash,
        })

        return { ...summary, token }
    }
}
