import { NotificationRepository } from '@/core/repositories/notification-repository'

export class MarkAllNotificationsAsReadUseCase {
    constructor(private notificationRepository: NotificationRepository) { }

    async execute(userId: string): Promise<number> {
        return await this.notificationRepository.markAllAsRead(userId)
    }
}
