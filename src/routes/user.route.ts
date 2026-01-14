import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma'

export async function userRoutes(app: FastifyInstance) {
    app.get('/users/clerk/:clerkId', async (request: FastifyRequest<{
        Params: { clerkId: string }
    }>, reply: FastifyReply) => {
        try {
            const { clerkId } = request.params

            console.log(`🔍 [USER] Buscando usuário com Clerk ID: ${clerkId}`)

            const user = await prisma.user.findUnique({
                where: {
                    clerk_id: clerkId,
                },
                select: {
                    id: true,
                },
            })

            if (!user) {
                console.log(`⚠️ [USER] Usuário não encontrado: ${clerkId}`)
                return reply.status(404).send({ error: 'User not found' })
            }

            console.log(`✅ [USER] Usuário encontrado: ${user.id}`)

            return reply.status(200).send({ userId: user.id })
        } catch (error) {
            console.error('❌ [USER] Erro ao buscar usuário:', error)

            if (error instanceof Error) {
                console.error(`📛 [USER] Tipo do erro: ${error.name}`)
                console.error(`💬 [USER] Mensagem: ${error.message}`)
            }

            return reply.status(500).send({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            })
        }
    })
}
