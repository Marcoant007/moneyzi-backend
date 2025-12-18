import { buildTransactionHandlerChain } from '@/core/handlers/build-transaction-handler'
import * as amqp from 'amqplib'
import logger from '@/lib/logger'
import { getRequiredEnv } from '@/utils/required-env'
import { TransactionMessage } from '@/core/types/transaction-message'
import { PrismaImportJobRepository } from '@/infra/repositories/prisma/prisma-import-job-repository'
import { ImportJobStatus } from '@prisma/client'

let connection: any
let channel: amqp.Channel
const importJobRepository = new PrismaImportJobRepository()

const QUEUE_NAME = process.env.IMPORT_QUEUE_NAME || 'transaction_import'
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://marcoant007:mordekai07@localhost:5672'

export async function connectRabbitMQ() {
    try {
        const conn = await amqp.connect(RABBITMQ_URL)
        connection = conn
        channel = await conn.createChannel()
        await channel.assertQueue(QUEUE_NAME, { durable: true })
        if (typeof channel.prefetch === 'function') {
            channel.prefetch(1)
        }
        logger.info({ url: RABBITMQ_URL, queue: QUEUE_NAME }, 'Conectado ao RabbitMQ')
    } catch (err) {
        console.error('❌ Erro conectando ao RabbitMQ:', err)
        throw err
    }
}

export function publishToQueue(message: TransactionMessage) {
    if (!channel) throw new Error('Canal do RabbitMQ não inicializado.')
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
        persistent: true
    })
    logger.debug({ queue: QUEUE_NAME }, 'Mensagem publicada na fila')
}

export async function startConsumer() {
    if (!channel) throw new Error('Canal do RabbitMQ não inicializado.')
    channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return

        const content = msg.content.toString()
        const data: TransactionMessage = JSON.parse(content)

        if (data.date && typeof data.date === 'string') {
            data.date = new Date(data.date)
        }

        const chain = buildTransactionHandlerChain()
        try {
            await chain.handle(data)
            channel.ack(msg)
        } catch (err) {
            console.error('Erro processando mensagem da fila:', err)
            try {
                const jobId = data.importJobId as string | undefined
                if (jobId) {
                    await importJobRepository.markStatus(jobId, ImportJobStatus.FAILED)
                }
            } catch (e) {
                console.warn('Não foi possível atualizar ImportJob para FAILED:', e)
            }
            channel.ack(msg)
        }
    })

    logger.info({ queue: QUEUE_NAME }, 'Consumidor escutando a fila')
}


