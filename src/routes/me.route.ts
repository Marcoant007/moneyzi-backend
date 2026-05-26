import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma'

export async function meRoutes(app: FastifyInstance) {
    app.get('/users/me/terms', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = request.headers['x-user-id'] as string

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { termsAcceptedAt: true },
            })

            return reply.send({ hasAccepted: !!user?.termsAcceptedAt })
        } catch (error) {
            return reply.status(500).send({ error: 'Internal server error' })
        }
    })

    app.patch('/users/me/terms', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = request.headers['x-user-id'] as string

            await prisma.user.update({
                where: { id: userId },
                data: { termsAcceptedAt: new Date() },
            })

            return reply.send({ success: true })
        } catch (error) {
            return reply.status(500).send({ error: 'Internal server error' })
        }
    })
}
