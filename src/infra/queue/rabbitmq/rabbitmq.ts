import * as amqp from 'amqplib'
import { buildTransactionHandlerChain } from '@/core/handlers/build-transaction-handler'
import { TransactionMessage } from '@/core/types/transaction-message'
import { PrismaImportJobRepository } from '@/infra/repositories/prisma/prisma-import-job-repository'
import logger from '@/lib/logger'

let connection: amqp.ChannelModel | undefined
let channel: amqp.Channel | undefined

const importJobRepository = new PrismaImportJobRepository()

const QUEUE_NAME = process.env.IMPORT_QUEUE_NAME || 'transaction_import'
const DLQ_NAME = process.env.IMPORT_DLQ_NAME || `${QUEUE_NAME}.dlq`
const RABBITMQ_URL = process.env.RABBITMQ_URL || ''

function getChannel(): amqp.Channel {
    if (!channel) {
        throw new Error('Canal do RabbitMQ nao inicializado.')
    }

    return channel
}

function publishPayload(queueName: string, payload: Buffer, headers?: Record<string, unknown>) {
    const activeChannel = getChannel()

    activeChannel.sendToQueue(queueName, payload, {
        persistent: true,
        headers,
    })
}

async function publishToDlq(msg: amqp.ConsumeMessage, error: unknown) {
    publishPayload(DLQ_NAME, msg.content, {
        ...msg.properties.headers,
        'x-error-message': error instanceof Error ? error.message : 'unknown error',
        'x-original-queue': QUEUE_NAME,
    })
}

export async function connectRabbitMQ() {
    if (!RABBITMQ_URL) {
        throw new Error('RABBITMQ_URL environment variable is required')
    }

    try {
        logger.info(
            { url: RABBITMQ_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') },
            'Conectando ao RabbitMQ...',
        )

        connection = await amqp.connect(RABBITMQ_URL)
        channel = await connection.createChannel()

        // Respeita a topologia existente no broker sem mudar argumentos da fila principal.
        await channel.assertQueue(QUEUE_NAME, { durable: true })
        await channel.assertQueue(DLQ_NAME, { durable: true })

        if (typeof channel.prefetch === 'function') {
            channel.prefetch(1)
        }

        logger.info(
            { queue: QUEUE_NAME, dlq: DLQ_NAME },
            'Conectado ao RabbitMQ',
        )
    } catch (err) {
        logger.error({ error: err }, 'Erro conectando ao RabbitMQ')
        throw err
    }
}

export function publishToQueue(message: TransactionMessage) {
    publishPayload(QUEUE_NAME, Buffer.from(JSON.stringify(message)))
    logger.debug({ queue: QUEUE_NAME }, 'Mensagem publicada na fila')
}

async function finalizeJob(jobId: string | undefined, didFail: boolean) {
    if (!jobId) return

    try {
        await importJobRepository.registerAttempt(jobId, didFail)
    } catch (error) {
        logger.warn({ err: error, jobId, didFail }, 'Nao foi possivel atualizar progresso do ImportJob')
    }
}

export async function startConsumer() {
    const activeChannel = getChannel()

    activeChannel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return

        let parsed: TransactionMessage | undefined

        try {
            parsed = JSON.parse(msg.content.toString()) as TransactionMessage

            if (parsed.date && typeof parsed.date === 'string') {
                parsed.date = new Date(parsed.date)
            }

            const chain = buildTransactionHandlerChain()
            await chain.handle(parsed)
            await finalizeJob(parsed.importJobId, false)
            activeChannel.ack(msg)
        } catch (error) {
            logger.error({
                err: error,
                queue: QUEUE_NAME,
                dlq: DLQ_NAME,
                jobId: parsed?.importJobId,
            }, 'Erro processando mensagem da fila; enviando para DLQ')

            try {
                await publishToDlq(msg, error)
                await finalizeJob(parsed?.importJobId, true)
                activeChannel.ack(msg)
                logger.warn({
                    queue: DLQ_NAME,
                    jobId: parsed?.importJobId,
                }, 'Mensagem enviada para DLQ')
            } catch (dlqError) {
                logger.error({
                    err: dlqError,
                    queue: DLQ_NAME,
                    jobId: parsed?.importJobId,
                }, 'Falha ao enviar mensagem para DLQ; reencaminhando para a fila principal')

                activeChannel.nack(msg, false, true)
            }
        }
    })

    logger.info({ queue: QUEUE_NAME, dlq: DLQ_NAME }, 'Consumidor escutando a fila')
}
