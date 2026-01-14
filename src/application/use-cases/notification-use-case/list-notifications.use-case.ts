import { NotificationRepository } from '@/core/repositories/notification-repository'
import { Notification } from '@/core/entities/notification.entity'

export class ListNotificationsUseCase {
    constructor(private notificationRepository: NotificationRepository) { }

    async execute(userId: string, includeRead: boolean = false): Promise<Notification[]> {
        return await this.notificationRepository.findByUserId(userId, includeRead)
    }
}
