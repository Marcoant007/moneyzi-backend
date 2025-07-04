import 'dotenv/config'
import { connectRabbitMQ, startConsumer } from '@/infra/queue/rabbitmq/rabbitmq'
import fastifyMultipart from '@fastify/multipart'
import { importRoutes } from '@routes/import.route'
import Fastify from 'fastify'

async function bootstrap() {
    const app = Fastify()

    app.register(fastifyMultipart)
    app.register(importRoutes)

    await connectRabbitMQ()
    await startConsumer()

    app.listen({ port: 3333 }).then(() => {
        console.log('🚀 HTTP server running on http://localhost:3333')
    })
}

bootstrap()
