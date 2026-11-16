import { NotificationRepository } from '@/core/repositories/notification-repository'

export class MarkNotificationAsReadUseCase {
    constructor(private notificationRepository: NotificationRepository) { }

    // Só marca se a notificação for do usuário; false = não existe ou é de outro.
    async execute(id: string, userId: string): Promise<boolean> {
        return this.notificationRepository.markAsRead(id, userId)
    }
}
