import 'dotenv/config'
import { connectRabbitMQ, startConsumer } from '@/infra/queue/rabbitmq/rabbitmq'
import fastifyMultipart from '@fastify/multipart'
import { importRoutes } from '@routes/import.route'
import Fastify from 'fastify'
import headerAuth from '@/infra/auth/header-auth'
import logger from '@/lib/logger'

async function bootstrap() {
    const app = Fastify()

    await headerAuth(app)

    app.register(fastifyMultipart)
    app.register(importRoutes)

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
