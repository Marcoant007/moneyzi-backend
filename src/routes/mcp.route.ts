import { FastifyInstance } from 'fastify'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import mcpBearerAuth from '@/infra/auth/mcp-bearer-auth'
import { buildMcpServer } from '@/application/use-cases/mcp-use-case/build-mcp-server'
import { buildMcpTools } from '@/application/use-cases/mcp-use-case/mcp-tools'
import { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case'
import { ListAccountsUseCase } from '@/application/use-cases/account-use-case/list-accounts.use-case'
import { GetCategoryMonthMatrixUseCase } from '@/application/use-cases/dashboard-use-case/get-category-month-matrix.use-case'
import { ListCategoriesUseCase } from '@/application/use-cases/category-use-case/list-categories.use-case'
import { CreateCategoryUseCase } from '@/application/use-cases/category-use-case/create-category.use-case'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'
import { CreateCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/create-category-for-mcp.use-case'
import { MoveTransactionCategoryUseCase } from '@/application/use-cases/mcp-write-use-case/move-transaction-category.use-case'
import { BulkMoveTransactionsUseCase } from '@/application/use-cases/mcp-write-use-case/bulk-move-transactions.use-case'
import { RollbackOperationUseCase } from '@/application/use-cases/mcp-write-use-case/rollback-operation.use-case'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'
import { PrismaAccountRepository } from '@/infra/repositories/prisma/prisma-account-repository'
import { PrismaMcpAuditLogRepository } from '@/infra/repositories/prisma/prisma-mcp-audit-log-repository'

/**
 * Servidor MCP pessoal: qualquer token pessoal válido (ver mcp-bearer-auth.ts,
 * gerenciados em /mcp-tokens) dá acesso — sempre escopado ao dono do token,
 * nunca a um userId fixo. As tools são montadas por requisição, usando o
 * userId e o scope que a auth resolveu para aquela chamada específica — as
 * tools de escrita só entram na lista quando o token tem scope read_write.
 */
export async function mcpRoutes(app: FastifyInstance) {
    await app.register(async (mcpApp) => {
        await mcpBearerAuth(mcpApp)

        mcpApp.post('/mcp', async (request, reply) => {
            const userId = request.mcpUserId
            const scope = request.mcpScope
            if (!userId || !scope) {
                return reply.status(401).send({ error: 'Invalid or missing bearer token' })
            }

            const transactionRepository = new PrismaTransactionRepository()
            const categoryRepository = new PrismaCategoryRepository()
            const accountRepository = new PrismaAccountRepository()
            const mcpAuditLogRepository = new PrismaMcpAuditLogRepository()

            const updateMultipleTransactionsUseCase = new UpdateMultipleTransactionsUseCase(transactionRepository)

            const tools = buildMcpTools({
                userId,
                scope,
                getMonthlySummaryUseCase: new GetMonthlySummaryUseCase(transactionRepository, categoryRepository),
                listTransactionsUseCase: new ListTransactionsUseCase(transactionRepository),
                getPayablesReceivablesUseCase: new GetPayablesReceivablesUseCase(transactionRepository),
                listAccountsUseCase: new ListAccountsUseCase(accountRepository),
                getCategoryMonthMatrixUseCase: new GetCategoryMonthMatrixUseCase(transactionRepository, categoryRepository),
                listCategoriesUseCase: new ListCategoriesUseCase(categoryRepository, transactionRepository),
                createCategoryForMcpUseCase: new CreateCategoryForMcpUseCase(
                    categoryRepository,
                    new CreateCategoryUseCase(categoryRepository),
                    mcpAuditLogRepository,
                ),
                moveTransactionCategoryUseCase: new MoveTransactionCategoryUseCase(
                    transactionRepository,
                    categoryRepository,
                    updateMultipleTransactionsUseCase,
                    mcpAuditLogRepository,
                ),
                bulkMoveTransactionsUseCase: new BulkMoveTransactionsUseCase(
                    transactionRepository,
                    categoryRepository,
                    updateMultipleTransactionsUseCase,
                    mcpAuditLogRepository,
                ),
                rollbackOperationUseCase: new RollbackOperationUseCase(
                    mcpAuditLogRepository,
                    transactionRepository,
                    new DeleteCategoryUseCase(categoryRepository),
                ),
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
