import { NotificationRepository } from '@/core/repositories/notification-repository'
import { Notification, CreateNotificationInput } from '@/core/entities/notification.entity'
import { prisma } from '@/lib/prisma'

export class PrismaNotificationRepository implements NotificationRepository {
    async create(data: CreateNotificationInput): Promise<Notification> {
        const notification = await prisma.notification.create({
            data: {
                userId: data.userId,
                type: data.type,
                title: data.title,
                message: data.message,
                transactionId: data.transactionId,
            },
        })

        return notification as Notification
    }

    async findById(id: string): Promise<Notification | null> {
        const notification = await prisma.notification.findUnique({
            where: { id },
        })

        return notification as Notification | null
    }

    async findByUserId(
        userId: string,
        includeRead: boolean = false,
    ): Promise<Notification[]> {
        const notifications = await prisma.notification.findMany({
            where: {
                userId,
                ...(includeRead ? {} : { isRead: false }),
            },
            orderBy: {
                createdAt: 'desc',
            },
        })

        return notifications as Notification[]
    }

    async markAsRead(id: string): Promise<Notification> {
        const notification = await prisma.notification.update({
            where: { id },
            data: { isRead: true },
        })

        return notification as Notification
    }

    async markAllAsRead(userId: string): Promise<number> {
        const result = await prisma.notification.updateMany({
            where: {
                userId,
                isRead: false,
            },
            data: {
                isRead: true,
            },
        })

        return result.count
    }

    async delete(id: string): Promise<void> {
        await prisma.notification.delete({
            where: { id },
        })
    }

    async findRecentByTypeAndTransaction(
        userId: string,
        type: string,
        transactionId: string,
        hoursAgo: number,
    ): Promise<Notification | null> {
        const timeThreshold = new Date()
        timeThreshold.setHours(timeThreshold.getHours() - hoursAgo)

        const notification = await prisma.notification.findFirst({
            where: {
                userId,
                type: type as any,
                transactionId,
                createdAt: {
                    gte: timeThreshold,
                },
            },
        })

        return notification as Notification | null
    }
}
