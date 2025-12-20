import 'dotenv/config'
import { connectRabbitMQ, startConsumer } from '@/infra/queue/rabbitmq/rabbitmq'
import fastifyMultipart from '@fastify/multipart'
import { importRoutes } from '@routes/import.route'
import Fastify from 'fastify'
import headerAuth from '@/infra/auth/header-auth'
import logger from '@/lib/logger'

let app: any = null

async function buildApp() {
    if (app) return app

    app = Fastify({
        logger: false // Disable Fastify logger in serverless
    })

    await headerAuth(app)
    app.register(fastifyMultipart)
    app.register(importRoutes)

    // Skip RabbitMQ in serverless environment
    if (process.env.DISABLE_QUEUE !== 'true' && process.env.VERCEL !== '1') {
        try {
            await connectRabbitMQ()
            await startConsumer()
        } catch (err: any) {
            logger.error('Failed to connect RabbitMQ', err)
            logger.warn('RabbitMQ unavailable, continuing without queue')
        }
    }

    await app.ready()
    return app
}

export default async function handler(req: any, res: any) {
    const app = await buildApp()
    await app.ready()
    // @ts-ignore
    app.server.emit('request', req, res)
}
