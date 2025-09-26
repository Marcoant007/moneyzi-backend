import 'dotenv/config'
import { connectRabbitMQ, startConsumer } from '@/infra/queue/rabbitmq/rabbitmq'
import fastifyMultipart from '@fastify/multipart'
import { importRoutes } from '@routes/import.route'
import Fastify from 'fastify'
import headerAuth from '@/infra/auth/header-auth'

async function bootstrap() {
    const app = Fastify()

    await headerAuth(app)

    app.register(fastifyMultipart)
    app.register(importRoutes)

    // If you want to run without RabbitMQ (e.g. docker stopped), set DISABLE_QUEUE=true in .env
    if (process.env.DISABLE_QUEUE === 'true') {
        console.log('⚠️ Queues disabled via DISABLE_QUEUE=true; skipping RabbitMQ connection')
    } else {
        try {
            await connectRabbitMQ()
            await startConsumer()
        } catch (err) {
            console.warn('⚠️ RabbitMQ unavailable, continuing without queue:', err instanceof Error ? err.message : err)
        }
    }

    app.listen({ port: 3333 }).then(() => {
        console.log('🚀 HTTP server running on http://localhost:3333')
    }).catch((err) => {
        console.error('Failed to start server', err)
        process.exit(1)
    })
}

bootstrap()
