import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { CreateMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/create-mcp-token.use-case'
import { ListMcpTokensUseCase } from '@/application/use-cases/mcp-token-use-case/list-mcp-tokens.use-case'
import { RevokeMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/revoke-mcp-token.use-case'
import { DeleteMcpTokenUseCase } from '@/application/use-cases/mcp-token-use-case/delete-mcp-token.use-case'

const createBodySchema = z.object({
    name: z.string().max(100).optional(),
    client: z.enum(['claude', 'chatgpt', 'gemini']).optional(),
})

export class McpTokenController {
    constructor(
        private readonly createMcpTokenUseCase: CreateMcpTokenUseCase,
        private readonly listMcpTokensUseCase: ListMcpTokensUseCase,
        private readonly revokeMcpTokenUseCase: RevokeMcpTokenUseCase,
        private readonly deleteMcpTokenUseCase: DeleteMcpTokenUseCase,
    ) { }

    async create(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const { name, client } = createBodySchema.parse(request.body ?? {})
            const result = await this.createMcpTokenUseCase.execute(userId, name, client)
            return reply.status(201).send(result)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to create MCP token' })
        }
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const result = await this.listMcpTokensUseCase.execute(userId)
            return reply.send(result)
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to list MCP tokens' })
        }
    }

    async revoke(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const { id } = request.params as { id: string }
            const revoked = await this.revokeMcpTokenUseCase.execute(id, userId)

            if (!revoked) {
                return reply.status(404).send({ error: 'MCP token not found' })
            }

            return reply.status(204).send()
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to revoke MCP token' })
        }
    }

    async deletePermanently(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string
        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const { id } = request.params as { id: string }
            const deleted = await this.deleteMcpTokenUseCase.execute(id, userId)

            if (!deleted) {
                return reply.status(404).send({ error: 'MCP token not found or not revoked yet' })
            }

            return reply.status(204).send()
        } catch (error: any) {
            console.error(error)
            return reply.status(400).send({ error: error.message || 'Failed to delete MCP token' })
        }
    }
}
