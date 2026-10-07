import { NotificationRepository } from '@/core/repositories/notification-repository'
import { TransactionRepository } from '@/application/repositories/transaction-repository'
import { NotificationType } from '@/core/entities/notification.entity'
import { sendEmail } from '@/infra/email/resend-email-service'
import { buildDueDateReminderEmail, buildOverdueEmail } from '@/infra/email/templates/due-date-email'

interface CheckDueDatesResult {
    remindersSent: number
    overdueNotifications: number
}

export class CheckDueDatesUseCase {
    constructor(
        private notificationRepository: NotificationRepository,
        private transactionRepository: TransactionRepository,
    ) { }

    async execute(): Promise<CheckDueDatesResult> {
        console.log('📅 [USE CASE] Iniciando busca de transações com vencimento próximo...')

        const now = new Date()
        const threeDaysFromNow = new Date()
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)

        let remindersSent = 0
        let overdueNotifications = 0

        try {
            console.log(`🔍 [USE CASE] Buscando transações vencendo entre ${now.toLocaleDateString('pt-BR')} e ${threeDaysFromNow.toLocaleDateString('pt-BR')}`)

            const upcomingTransactions =
                await this.transactionRepository.findUpcoming(
                    now,
                    threeDaysFromNow,
                )

            console.log(`📦 [USE CASE] Encontradas ${upcomingTransactions.length} transações vencendo em breve`)

            for (const transaction of upcomingTransactions) {
                const existingNotification =
                    await this.notificationRepository.findRecentByTypeAndTransaction(
                        transaction.userId,
                        NotificationType.DUE_DATE_REMINDER,
                        transaction.id,
                        24,
                    )

                if (!existingNotification && transaction.dueDate) {
                    const daysUntilDue = Math.ceil(
                        (transaction.dueDate.getTime() - now.getTime()) /
                        (1000 * 60 * 60 * 24),
                    )

                    await this.notificationRepository.create({
                        userId: transaction.userId,
                        type: NotificationType.DUE_DATE_REMINDER,
                        title: `Vencimento em ${daysUntilDue} dia${daysUntilDue > 1 ? 's' : ''}`,
                        message: `A conta "${transaction.name}" de R$ ${transaction.amount.toString()} vence em ${transaction.dueDate.toLocaleDateString('pt-BR')}`,
                        transactionId: transaction.id,
                    })

                    if (transaction.user?.email) {
                        const { subject, html } = buildDueDateReminderEmail({
                            userName: transaction.user.name,
                            transactionName: transaction.name,
                            amount: transaction.amount.toString(),
                            dueDate: transaction.dueDate,
                            daysUntilDue,
                        })
                        await sendEmail({ to: transaction.user.email, subject, html })
                    }

                    console.log(`✉️  [USE CASE] Lembrete criado: "${transaction.name}" vence em ${daysUntilDue} dia(s)`)
                    remindersSent++
                }
            }

            console.log(`🔍 [USE CASE] Buscando transações vencidas...`)

            const overdueTransactions =
                await this.transactionRepository.findOverdue(now)

            console.log(`📦 [USE CASE] Encontradas ${overdueTransactions.length} transações vencidas`)

            for (const transaction of overdueTransactions) {
                const existingNotification =
                    await this.notificationRepository.findRecentByTypeAndTransaction(
                        transaction.userId,
                        NotificationType.OVERDUE,
                        transaction.id,
                        24,
                    )

                if (!existingNotification && transaction.dueDate) {
                    const daysOverdue = Math.ceil(
                        (now.getTime() - transaction.dueDate.getTime()) /
                        (1000 * 60 * 60 * 24),
                    )

                    await this.notificationRepository.create({
                        userId: transaction.userId,
                        type: NotificationType.OVERDUE,
                        title: 'Conta Vencida!',
                        message: `A conta "${transaction.name}" de R$ ${transaction.amount.toString()} venceu há ${daysOverdue} dia${daysOverdue > 1 ? 's' : ''}`,
                        transactionId: transaction.id,
                    })

                    if (transaction.user?.email) {
                        const { subject, html } = buildOverdueEmail({
                            userName: transaction.user.name,
                            transactionName: transaction.name,
                            amount: transaction.amount.toString(),
                            dueDate: transaction.dueDate,
                            daysOverdue,
                        })
                        await sendEmail({ to: transaction.user.email, subject, html })
                    }

                    console.log(`⚠️  [USE CASE] Notificação de atraso criada: "${transaction.name}" - ${daysOverdue} dia(s) em atraso`)
                    overdueNotifications++
                }
            }

            console.log(`✅ [USE CASE] Processamento concluído com sucesso`)

            return {
                remindersSent,
                overdueNotifications,
            }
        } catch (error) {
            console.error('❌ [USE CASE] Erro durante execução:', error)
            throw error
        }
    }
}
