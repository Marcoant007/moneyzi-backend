import 'dotenv/config'
import { connectRabbitMQ, startConsumer } from '@/infra/queue/rabbitmq/rabbitmq'
import fastifyMultipart from '@fastify/multipart'
import fastifyCors from '@fastify/cors'
import { importRoutes } from '@routes/import.route'
import { categoryRoutes } from '@routes/category.route'
import { reportRoutes } from '@routes/report.routes'
import { notificationRoutes } from '@routes/notification.route'
import { cronRoutes } from '@routes/cron.route'
import { userRoutes } from '@routes/user.route'
import { creditCardRoutes } from '@routes/credit-card.route'
import { payablesRoutes } from '@routes/payables.route'
import Fastify from 'fastify'
import headerAuth from '@/infra/auth/header-auth'
import logger from '@/lib/logger'

async function bootstrap() {
    const app = Fastify()

    await app.register(fastifyCors, {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true
    })

    await app.register(cronRoutes)
    await app.register(userRoutes)

    await app.register(async (protectedApp) => {
        await headerAuth(protectedApp)

        protectedApp.register(fastifyMultipart)
        protectedApp.register(importRoutes)
        protectedApp.register(categoryRoutes)
        protectedApp.register(reportRoutes)
        protectedApp.register(notificationRoutes)
        protectedApp.register(creditCardRoutes)
        protectedApp.register(payablesRoutes)
    })

    if (process.env.DISABLE_QUEUE === 'true') {
        logger.warn('Queues disabled via DISABLE_QUEUE=true; skipping RabbitMQ connection')
    } else {
        try {
            await connectRabbitMQ()
            await startConsumer()
        } catch (err: any) {
            logger.error('Failed to start server', err)
            logger.warn('RabbitMQ unavailable, continuing without queue')
        }
    }

    const port = Number(process.env.PORT) || 3333
    const host = process.env.HOST || '0.0.0.0'

    app.listen({ port, host }).then(() => {
        logger.info(`HTTP server running on http://${host}:${port}`)
    }).catch((err) => {
        logger.error('Failed to start server', err)
        process.exit(1)
    })
}

bootstrap()
