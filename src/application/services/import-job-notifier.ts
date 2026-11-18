import { NotificationType } from '@/core/entities/notification.entity'
import type { NotificationRepository } from '@/core/repositories/notification-repository'
import logger from '@/lib/logger'

// Bell notification for a finished card-statement import, so the user sees
// the result even if they closed the tab before the in-app toast fired.
// Texts are Portuguese (backend convention); the app translates these two
// types for English users (see moneyzi/app/_components/notifications-dropdown).

export interface FinishedImportJob {
    id: string
    userId: string
    total: number
    status: string
    creditCardId?: string | null
}

export type ImportJobNotifier = (job: FinishedImportJob) => Promise<void>

export function buildImportNotification(
    job: Pick<FinishedImportJob, 'total' | 'status'>,
    cardName?: string | null,
): { type: NotificationType; title: string; message: string } {
    const fromCard = cardName ? ` da fatura do ${cardName}` : ''

    if (job.status === 'COMPLETED') {
        const items = job.total === 1 ? '1 compra' : `${job.total} compras`
        const verb = job.total === 1 ? 'foi importada e categorizada' : 'foram importadas e categorizadas'
        return {
            type: NotificationType.IMPORT_COMPLETED,
            title: 'Fatura importada',
            message: `${items}${fromCard} ${verb}.`,
        }
    }

    return {
        type: NotificationType.IMPORT_FAILED,
        title: 'Erro na importação',
        message: `Não conseguimos importar todas as compras${fromCard}. Confira suas transações.`,
    }
}

/**
 * Creates the notification. Never throws: a failed notification must not
 * break the import itself.
 */
export function createImportJobNotifier(deps: {
    notificationRepository: Pick<NotificationRepository, 'create'>
    findCardName: (creditCardId: string) => Promise<string | null>
}): ImportJobNotifier {
    return async (job) => {
        try {
            const cardName = job.creditCardId ? await deps.findCardName(job.creditCardId) : null
            const { type, title, message } = buildImportNotification(job, cardName)
            await deps.notificationRepository.create({ userId: job.userId, type, title, message })
        } catch (error) {
            logger.warn({ err: error, jobId: job.id }, 'Nao foi possivel criar a notificacao da importacao')
        }
    }
}
