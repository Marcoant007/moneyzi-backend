import { FastifyInstance } from 'fastify'
import { McpTokenController } from '@/application/controllers/mcp-token-controller'
import { CreateMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/create-mcp-token.use-case'
import { ListMcpTokensUseCase } from '@/application/use-cases/mcp-token-use-case/list-mcp-tokens.use-case'
import { RevokeMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/revoke-mcp-token.use-case'
import { PrismaMcpTokenRepository } from '@/infra/repositories/prisma/prisma-mcp-token-repository'

function buildMcpTokenController(): McpTokenController {
    const mcpTokenRepository = new PrismaMcpTokenRepository()

    return new McpTokenController(
        new CreateMcpTokenUseCase(mcpTokenRepository),
        new ListMcpTokensUseCase(mcpTokenRepository),
        new RevokeMcpTokenUseCase(mcpTokenRepository),
    )
}

export async function mcpTokenRoutes(app: FastifyInstance) {
    const controller = buildMcpTokenController()

    app.post('/mcp-tokens', (req, reply) => controller.create(req, reply))
    app.get('/mcp-tokens', (req, reply) => controller.list(req, reply))
    app.delete('/mcp-tokens/:id', (req, reply) => controller.revoke(req, reply))
}
