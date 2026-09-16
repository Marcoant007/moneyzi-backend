import type { McpTokenRepository } from '@/application/repositories/mcp-token-repository'

export class RevokeMcpTokenUseCase {
    constructor(private readonly mcpTokenRepository: McpTokenRepository) {}

    async execute(id: string, userId: string): Promise<boolean> {
        return this.mcpTokenRepository.revoke(id, userId)
    }
}
