import type { McpTokenRepository } from '@/application/repositories/mcp-token-repository'

export class ListMcpTokensUseCase {
    constructor(private readonly mcpTokenRepository: McpTokenRepository) {}

    async execute(userId: string) {
        return this.mcpTokenRepository.findManyByUserId(userId)
    }
}
