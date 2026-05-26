import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma'

export async function userRoutes(app: FastifyInstance) {
    app.get('/users/clerk/:clerkId', async (request: FastifyRequest<{
        Params: { clerkId: string }
    }>, reply: FastifyReply) => {
        try {
            const { clerkId } = request.params

            const user = await prisma.user.findUnique({
                where: { clerk_id: clerkId },
                select: { id: true },
            })

            if (!user) {
                return reply.status(404).send({ error: 'User not found' })
            }

            return reply.status(200).send({ userId: user.id })
        } catch (error) {
            return reply.status(500).send({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            })
        }
    })

}
