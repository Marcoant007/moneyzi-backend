import { FastifyInstance } from 'fastify'
import { PrismaNotificationRepository } from '@/infra/repositories/prisma/prisma-notification-repository'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { ListNotificationsUseCase } from '@/application/use-cases/notification-use-case/list-notifications.use-case'
import { MarkNotificationAsReadUseCase } from '@/application/use-cases/notification-use-case/mark-notification-as-read.use-case'
import { MarkAllNotificationsAsReadUseCase } from '@/application/use-cases/notification-use-case/mark-all-notifications-as-read.use-case'
import { CheckDueDatesUseCase } from '@/application/use-cases/notification-use-case/check-due-dates.use-case'
import { NotificationController } from '@/application/controllers/notification-controller'

const notificationController = buildNotificationController()

export async function notificationRoutes(app: FastifyInstance) {
    app.get('/notifications', (request, reply) =>
        notificationController.list(request, reply),
    )
    app.patch('/notifications/:id/read', (request, reply) =>
        notificationController.markAsRead(request, reply),
    )
    app.post('/notifications/read-all', (request, reply) =>
        notificationController.markAllAsRead(request, reply),
    )
}

function buildNotificationController(): NotificationController {
    const notificationRepository = new PrismaNotificationRepository()
    const transactionRepository = new PrismaTransactionRepository()

    const listNotificationsUseCase = new ListNotificationsUseCase(
        notificationRepository,
    )
    const markNotificationAsReadUseCase = new MarkNotificationAsReadUseCase(
        notificationRepository,
    )
    const markAllNotificationsAsReadUseCase =
        new MarkAllNotificationsAsReadUseCase(notificationRepository)
    const checkDueDatesUseCase = new CheckDueDatesUseCase(
        notificationRepository,
        transactionRepository,
    )

    return new NotificationController(
        listNotificationsUseCase,
        markNotificationAsReadUseCase,
        markAllNotificationsAsReadUseCase,
        checkDueDatesUseCase,
    )
}
