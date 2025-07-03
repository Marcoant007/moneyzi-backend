import Fastify from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import { redis } from '@infra/cache/redis'
import { connectRabbitMQ, startConsumer } from '@infra/mensageria/rabbitmq/rabbitmq'
import { importRoutes } from '@routes/import.route'

async function bootstrap() {
    const app = Fastify()

    app.register(fastifyMultipart)
    app.register(importRoutes)

    await connectRabbitMQ()
    await redis.connect()
    await startConsumer()

    app.listen({ port: 3333 }).then(() => {
        console.log('🚀 HTTP server running on http://localhost:3333')
    })
}

bootstrap()
