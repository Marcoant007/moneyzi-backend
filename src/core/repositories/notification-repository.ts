import { Notification, CreateNotificationInput } from '@/core/entities/notification.entity'

export interface NotificationRepository {
    create(data: CreateNotificationInput): Promise<Notification>
    findById(id: string): Promise<Notification | null>
    findByUserId(userId: string, includeRead?: boolean): Promise<Notification[]>
    markAsRead(id: string): Promise<Notification>
    markAllAsRead(userId: string): Promise<number>
    delete(id: string): Promise<void>
    findRecentByTypeAndTransaction(
        userId: string,
        type: string,
        transactionId: string,
        hoursAgo: number
    ): Promise<Notification | null>
}
