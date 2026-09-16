import { FastifyInstance } from 'fastify'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import mcpBearerAuth from '@/infra/auth/mcp-bearer-auth'
import { buildMcpServer } from '@/application/use-cases/mcp-use-case/build-mcp-server'
import { buildMcpTools } from '@/application/use-cases/mcp-use-case/mcp-tools'
import { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'

/**
 * Servidor MCP pessoal: qualquer token pessoal válido (ver mcp-bearer-auth.ts,
 * gerenciados em /mcp-tokens) dá acesso — sempre escopado ao dono do token,
 * nunca a um userId fixo. As tools são montadas por requisição, usando o
 * userId que a auth resolveu para aquela chamada específica.
 */
export async function mcpRoutes(app: FastifyInstance) {
    await app.register(async (mcpApp) => {
        await mcpBearerAuth(mcpApp)

        mcpApp.post('/mcp', async (request, reply) => {
            const userId = request.mcpUserId
            if (!userId) {
                return reply.status(401).send({ error: 'Invalid or missing bearer token' })
            }

            const transactionRepository = new PrismaTransactionRepository()
            const categoryRepository = new PrismaCategoryRepository()

            const tools = buildMcpTools({
                userId,
                getMonthlySummaryUseCase: new GetMonthlySummaryUseCase(transactionRepository, categoryRepository),
                listTransactionsUseCase: new ListTransactionsUseCase(transactionRepository),
                getPayablesReceivablesUseCase: new GetPayablesReceivablesUseCase(transactionRepository),
            })

            const handler = createMcpHandler(() => buildMcpServer(tools))
            const nodeHandler = toNodeHandler(handler)

            reply.hijack()
            await nodeHandler(request.raw, reply.raw, request.body)
        })

        // Servidor stateless: não abre stream SSE nem mantém sessão. Por spec do
        // Streamable HTTP, GET/DELETE devem responder 405 (não 404) para o
        // cliente MCP reconhecer que deve seguir só com POST.
        mcpApp.get('/mcp', async (_request, reply) => {
            reply.header('Allow', 'POST').status(405).send({ error: 'Method Not Allowed' })
        })

        mcpApp.delete('/mcp', async (_request, reply) => {
            reply.header('Allow', 'POST').status(405).send({ error: 'Method Not Allowed' })
        })
    })
}
