import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaNotificationRepository } from '@/infra/repositories/prisma/prisma-notification-repository'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { CheckDueDatesUseCase } from '@/application/use-cases/notification-use-case/check-due-dates.use-case'

export async function cronRoutes(app: FastifyInstance) {
    app.get('/cron/check-due-dates', async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers.authorization
        const startTime = Date.now()

        console.log('🔔 [CRON] Iniciando verificação de vencimentos...')

        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            console.error('❌ [CRON] Autenticação falhou - Token inválido')
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const notificationRepository = new PrismaNotificationRepository()
            const transactionRepository = new PrismaTransactionRepository()
            const checkDueDatesUseCase = new CheckDueDatesUseCase(
                notificationRepository,
                transactionRepository,
            )

            console.log('⏳ [CRON] Processando transações...')
            const result = await checkDueDatesUseCase.execute()

            const duration = Date.now() - startTime

            console.log('✅ [CRON] Verificação concluída com sucesso!')
            console.log(`📊 [CRON] Resultado:`)
            console.log(`   - Lembretes enviados: ${result.remindersSent}`)
            console.log(`   - Notificações de atraso: ${result.overdueNotifications}`)
            console.log(`   - Tempo de execução: ${duration}ms`)

            return reply.status(200).send({
                success: true,
                ...result,
                timestamp: new Date().toISOString(),
                executionTime: `${duration}ms`,
            })
        } catch (error) {
            const duration = Date.now() - startTime

            console.error('❌ [CRON] ERRO ao verificar vencimentos!')
            console.error(`🕐 [CRON] Timestamp: ${new Date().toISOString()}`)
            console.error(`⏱️  [CRON] Tempo até falha: ${duration}ms`)

            if (error instanceof Error) {
                console.error(`📛 [CRON] Tipo do erro: ${error.name}`)
                console.error(`💬 [CRON] Mensagem: ${error.message}`)
                console.error(`📍 [CRON] Stack trace:`)
                console.error(error.stack)
            } else {
                console.error(`🔍 [CRON] Erro desconhecido:`, error)
            }

            return reply.status(500).send({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            })
        }
    })
}
