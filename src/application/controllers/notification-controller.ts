import { FastifyRequest, FastifyReply } from 'fastify'
import { ListNotificationsUseCase } from '@/application/use-cases/notification-use-case/list-notifications.use-case'
import { MarkNotificationAsReadUseCase } from '@/application/use-cases/notification-use-case/mark-notification-as-read.use-case'
import { MarkAllNotificationsAsReadUseCase } from '@/application/use-cases/notification-use-case/mark-all-notifications-as-read.use-case'
import { CheckDueDatesUseCase } from '@/application/use-cases/notification-use-case/check-due-dates.use-case'
import { prisma } from '@/lib/prisma'

export class NotificationController {
    constructor(
        private listNotificationsUseCase: ListNotificationsUseCase,
        private markNotificationAsReadUseCase: MarkNotificationAsReadUseCase,
        private markAllNotificationsAsReadUseCase: MarkAllNotificationsAsReadUseCase,
        private checkDueDatesUseCase: CheckDueDatesUseCase,
    ) { }

    private async getDbUserIdFromClerkId(clerkId: string): Promise<string | null> {
        const user = await prisma.user.findUnique({
            where: { id: clerkId },
            select: { id: true },
        })
        return user?.id || null
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        try {
            const clerkUserId = request.headers['x-user-id'] as string
            const { includeRead } = request.query as { includeRead?: string }

            if (!clerkUserId) {
                console.error('❌ [NOTIFICATIONS] Missing x-user-id header')
                return reply.status(401).send({ error: 'Unauthorized - Missing user ID' })
            }

            console.log(`🔍 [NOTIFICATIONS] Buscando notificações para Clerk ID: ${clerkUserId}`)

            const dbUserId = await this.getDbUserIdFromClerkId(clerkUserId)

            if (!dbUserId) {
                console.error(`❌ [NOTIFICATIONS] Usuário não encontrado: ${clerkUserId}`)
                return reply.status(404).send({ error: 'User not found' })
            }

            console.log(`✅ [NOTIFICATIONS] DB User ID encontrado: ${dbUserId}`)

            const notifications = await this.listNotificationsUseCase.execute(
                dbUserId,
                includeRead === 'true',
            )

            console.log(`📊 [NOTIFICATIONS] ${notifications.length} notificações encontradas`)

            return reply.status(200).send(notifications)
        } catch (error) {
            console.error('❌ [NOTIFICATIONS] Erro ao listar notificações:', error)

            if (error instanceof Error) {
                console.error(`📛 [NOTIFICATIONS] Tipo: ${error.name}`)
                console.error(`💬 [NOTIFICATIONS] Mensagem: ${error.message}`)
            }

            return reply.status(500).send({ error: 'Internal server error' })
        }
    }

    async markAsRead(request: FastifyRequest, reply: FastifyReply) {
        try {
            const { id } = request.params as { id: string }

            const notification =
                await this.markNotificationAsReadUseCase.execute(id)

            return reply.status(200).send(notification)
        } catch (error) {
            console.error('Error marking notification as read:', error)
            return reply.status(500).send({ error: 'Internal server error' })
        }
    }

    async markAllAsRead(request: FastifyRequest, reply: FastifyReply) {
        try {
            const clerkUserId = request.headers['x-user-id'] as string

            if (!clerkUserId) {
                console.error('❌ [NOTIFICATIONS] Missing x-user-id header')
                return reply.status(401).send({ error: 'Unauthorized - Missing user ID' })
            }

            console.log(`🔍 [NOTIFICATIONS] Marcando todas como lidas para Clerk ID: ${clerkUserId}`)

            const dbUserId = await this.getDbUserIdFromClerkId(clerkUserId)

            if (!dbUserId) {
                console.error(`❌ [NOTIFICATIONS] Usuário não encontrado: ${clerkUserId}`)
                return reply.status(404).send({ error: 'User not found' })
            }

            const count = await this.markAllNotificationsAsReadUseCase.execute(dbUserId)

            console.log(`✅ [NOTIFICATIONS] ${count} notificações marcadas como lidas`)

            return reply.status(200).send({ count })
        } catch (error) {
            console.error('❌ [NOTIFICATIONS] Erro ao marcar todas como lidas:', error)

            if (error instanceof Error) {
                console.error(`📛 [NOTIFICATIONS] Tipo: ${error.name}`)
                console.error(`💬 [NOTIFICATIONS] Mensagem: ${error.message}`)
            }

            return reply.status(500).send({ error: 'Internal server error' })
        }
    }

    async checkDueDates(request: FastifyRequest, reply: FastifyReply) {
        try {
            // Verificar authorization header
            const authHeader = request.headers.authorization

            if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
                return reply.status(401).send({ error: 'Unauthorized' })
            }

            const result = await this.checkDueDatesUseCase.execute()

            return reply.status(200).send({
                success: true,
                ...result,
                timestamp: new Date().toISOString(),
            })
        } catch (error) {
            console.error('Error checking due dates:', error)
            return reply.status(500).send({ error: 'Internal server error' })
        }
    }
}
