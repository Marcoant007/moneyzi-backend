import { describe, expect, it, vi } from 'vitest'
import { NotificationType } from '@/core/entities/notification.entity'
import { buildImportNotification, createImportJobNotifier } from '../import-job-notifier'

describe('buildImportNotification', () => {
    it('describes a finished import with the count and the card', () => {
        expect(buildImportNotification({ total: 5, status: 'COMPLETED' }, 'Nubank')).toEqual({
            type: NotificationType.IMPORT_COMPLETED,
            title: 'Fatura importada',
            message: '5 compras da fatura do Nubank foram importadas e categorizadas.',
        })
    })

    it('uses singular for a single purchase and works without a card', () => {
        expect(buildImportNotification({ total: 1, status: 'COMPLETED' }).message).toBe(
            '1 compra foi importada e categorizada.',
        )
    })

    it('flags a failed import', () => {
        const n = buildImportNotification({ total: 5, status: 'FAILED' }, 'Nubank')
        expect(n.type).toBe(NotificationType.IMPORT_FAILED)
        expect(n.title).toBe('Erro na importação')
        expect(n.message).toContain('fatura do Nubank')
    })
})

describe('createImportJobNotifier', () => {
    const job = { id: 'job-1', userId: 'user_1', total: 5, status: 'COMPLETED', creditCardId: 'card-1' }

    it('creates the bell notification for the job owner', async () => {
        const create = vi.fn().mockResolvedValue({})
        const notify = createImportJobNotifier({
            notificationRepository: { create },
            findCardName: vi.fn().mockResolvedValue('Nubank'),
        })

        await notify(job)

        expect(create).toHaveBeenCalledWith({
            userId: 'user_1',
            type: NotificationType.IMPORT_COMPLETED,
            title: 'Fatura importada',
            message: '5 compras da fatura do Nubank foram importadas e categorizadas.',
        })
    })

    it('never throws, so a notification problem cannot break the import', async () => {
        const notify = createImportJobNotifier({
            notificationRepository: { create: vi.fn().mockRejectedValue(new Error('enum value missing')) },
            findCardName: vi.fn().mockResolvedValue(null),
        })

        await expect(notify(job)).resolves.toBeUndefined()
    })
})
