import { NotificationRepository } from '@/core/repositories/notification-repository'
import { Notification } from '@/core/entities/notification.entity'

export class MarkNotificationAsReadUseCase {
    constructor(private notificationRepository: NotificationRepository) { }

    async execute(id: string): Promise<Notification> {
        return await this.notificationRepository.markAsRead(id)
    }
}
