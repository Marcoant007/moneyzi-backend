import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationType } from '@/core/entities/notification.entity'
import type { NotificationRepository } from '@/core/repositories/notification-repository'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'

const mocks = vi.hoisted(() => ({
    sendEmail: vi.fn(),
}))

vi.mock('@/infra/email/resend-email-service', () => ({
    sendEmail: mocks.sendEmail,
}))

function makeNotificationRepository(
    overrides: Partial<NotificationRepository> = {},
): NotificationRepository {
    return {
        create: vi.fn().mockResolvedValue(undefined),
        findById: vi.fn(),
        findByUserId: vi.fn(),
        markAsRead: vi.fn(),
        markAllAsRead: vi.fn(),
        delete: vi.fn(),
        findRecentByTypeAndTransaction: vi.fn().mockResolvedValue(null),
        ...overrides,
    } as unknown as NotificationRepository
}

function makeTransactionRepository(
    overrides: Partial<TransactionRepository> = {},
): TransactionRepository {
    return {
        findUpcoming: vi.fn().mockResolvedValue([]),
        findOverdue: vi.fn().mockResolvedValue([]),
        ...overrides,
    } as unknown as TransactionRepository
}

describe('CheckDueDatesUseCase', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('sends a reminder email for an upcoming due transaction', async () => {
        const { CheckDueDatesUseCase } = await import('../check-due-dates.use-case')

        const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        const transactionRepository = makeTransactionRepository({
            findUpcoming: vi.fn().mockResolvedValue([
                {
                    id: 'tx-1',
                    userId: 'user-1',
                    name: 'Internet',
                    amount: '119.00',
                    dueDate,
                    user: { email: 'marco@example.com', name: 'Marco' },
                },
            ]),
        })
        const notificationRepository = makeNotificationRepository()

        const sut = new CheckDueDatesUseCase(notificationRepository, transactionRepository)
        const result = await sut.execute()

        expect(result.remindersSent).toBe(1)
        expect(notificationRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1', type: NotificationType.DUE_DATE_REMINDER }),
        )
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
        expect(mocks.sendEmail).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'marco@example.com' }),
        )
    })

    it('sends an overdue email for a past-due transaction', async () => {
        const { CheckDueDatesUseCase } = await import('../check-due-dates.use-case')

        const dueDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        const transactionRepository = makeTransactionRepository({
            findOverdue: vi.fn().mockResolvedValue([
                {
                    id: 'tx-2',
                    userId: 'user-1',
                    name: 'UVV Karol',
                    amount: '333.00',
                    dueDate,
                    user: { email: 'marco@example.com', name: 'Marco' },
                },
            ]),
        })
        const notificationRepository = makeNotificationRepository()

        const sut = new CheckDueDatesUseCase(notificationRepository, transactionRepository)
        const result = await sut.execute()

        expect(result.overdueNotifications).toBe(1)
        expect(notificationRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1', type: NotificationType.OVERDUE }),
        )
        expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
        expect(mocks.sendEmail).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'marco@example.com' }),
        )
    })

    it('does not send an email or notification when one was already created in the last 24h (dedup)', async () => {
        const { CheckDueDatesUseCase } = await import('../check-due-dates.use-case')

        const dueDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        const transactionRepository = makeTransactionRepository({
            findOverdue: vi.fn().mockResolvedValue([
                {
                    id: 'tx-3',
                    userId: 'user-1',
                    name: 'UVV Karol',
                    amount: '333.00',
                    dueDate,
                    user: { email: 'marco@example.com', name: 'Marco' },
                },
            ]),
        })
        const notificationRepository = makeNotificationRepository({
            findRecentByTypeAndTransaction: vi.fn().mockResolvedValue({ id: 'existing-notification' }),
        })

        const sut = new CheckDueDatesUseCase(notificationRepository, transactionRepository)
        const result = await sut.execute()

        expect(result.overdueNotifications).toBe(0)
        expect(notificationRepository.create).not.toHaveBeenCalled()
        expect(mocks.sendEmail).not.toHaveBeenCalled()
    })
})
