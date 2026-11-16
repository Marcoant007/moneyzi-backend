import 'dotenv/config'
import { startQueueWithRetry } from '@/infra/queue/rabbitmq/rabbitmq'
import fastifyMultipart from '@fastify/multipart'
import fastifyCors from '@fastify/cors'
import fastifyFormbody from '@fastify/formbody'
import { importRoutes } from '@routes/import.route'
import { categoryRoutes } from '@routes/category.route'
import { reportRoutes } from '@routes/report.routes'
import { deepAnalysisRoutes } from '@routes/deep-analysis.routes'
import { notificationRoutes } from '@routes/notification.route'
import { cronRoutes } from '@routes/cron.route'
import { creditCardRoutes } from '@routes/credit-card.route'
import { payablesRoutes } from '@routes/payables.route'
import { accountRoutes } from '@routes/account.route'
import { transferRoutes } from '@routes/transfer.route'
import { transactionRoutes } from '@routes/transaction.route'
import { meRoutes } from '@routes/me.route'
import { mcpRoutes } from '@routes/mcp.route'
import { mcpTokenRoutes } from '@routes/mcp-token.route'
import { oauthRoutes } from '@routes/oauth.route'
import { oauthConsentRoutes } from '@routes/oauth-consent.route'
import Fastify from 'fastify'
import headerAuth from '@/infra/auth/header-auth'
import logger from '@/lib/logger'
import { registerErrorResponseSanitizer } from '@/infra/http/sanitize-error-responses'

async function bootstrap() {
    const app = Fastify()

    // Antes de qualquer rota: vale para todas as respostas de erro.
    registerErrorResponseSanitizer(app)

    // O navegador não chama este backend (só o servidor Next.js e clientes
    // OAuth/MCP, que não usam CORS). Sem FRONTEND_URL, nenhuma origem é liberada.
    await app.register(fastifyCors, {
        origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : false,
        credentials: true
    })
    // POST /oauth/token precisa aceitar application/x-www-form-urlencoded (RFC 6749 §4.1.3).
    await app.register(fastifyFormbody)

    await app.register(cronRoutes)
    await app.register(mcpRoutes)
    await app.register(oauthRoutes)

    await app.register(async (protectedApp) => {
        await headerAuth(protectedApp)

        protectedApp.register(fastifyMultipart, {
            // Faturas em CSV/OFX são pequenas; limites explícitos evitam abuso de memória.
            limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldSize: 1024 },
        })
        protectedApp.register(oauthConsentRoutes)
        protectedApp.register(importRoutes)
        protectedApp.register(categoryRoutes)
        protectedApp.register(reportRoutes)
        protectedApp.register(deepAnalysisRoutes)
        protectedApp.register(notificationRoutes)
        protectedApp.register(creditCardRoutes)
        protectedApp.register(payablesRoutes)
        protectedApp.register(accountRoutes)
        protectedApp.register(transferRoutes)
        protectedApp.register(transactionRoutes)
        protectedApp.register(meRoutes)
        protectedApp.register(mcpTokenRoutes)
    })

    const port = Number(process.env.PORT) || 3333
    const host = process.env.HOST || '0.0.0.0'

    app.listen({ port, host }).then(async () => {
        logger.info(`HTTP server running on http://${host}:${port}`)

        if (process.env.DISABLE_QUEUE === 'true') {
            logger.warn('Queues disabled via DISABLE_QUEUE=true; skipping RabbitMQ connection')
            return
        }

        // Conecta e consome; se o broker estiver fora, segue tentando em background.
        await startQueueWithRetry()
    }).catch((err) => {
        logger.error('Failed to start server', err)
        process.exit(1)
    })
}

bootstrap()
