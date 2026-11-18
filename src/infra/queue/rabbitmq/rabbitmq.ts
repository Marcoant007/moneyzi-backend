import * as amqp from 'amqplib'
import { buildTransactionHandlerChain } from '@/core/handlers/build-transaction-handler'
import { TransactionMessage } from '@/core/types/transaction-message'
import { PrismaImportJobRepository } from '@/infra/repositories/prisma/prisma-import-job-repository'
import { notifyImportFinished } from '@/infra/notifications/import-job-notifier'
import logger from '@/lib/logger'

let connection: amqp.ChannelModel | undefined
let channel: amqp.Channel | undefined
let reconnecting = false
let consuming = false

const importJobRepository = new PrismaImportJobRepository()

const QUEUE_NAME = process.env.IMPORT_QUEUE_NAME || 'transaction_import'
const DLQ_NAME = process.env.IMPORT_DLQ_NAME || `${QUEUE_NAME}.dlq`
const RABBITMQ_URL = process.env.RABBITMQ_URL || ''
const RECONNECT_DELAY_MS = 5000
const MAX_RECONNECT_DELAY_MS = 60000
let reconnectAttempt = 0

export class QueueUnavailableError extends Error {
    constructor() {
        super('Canal do RabbitMQ nao inicializado.')
        this.name = 'QueueUnavailableError'
    }
}

/** true quando há canal ativo para publicar. */
export function isQueueReady(): boolean {
    return Boolean(channel)
}

function getChannel(): amqp.Channel {
    if (!channel) {
        throw new QueueUnavailableError()
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

// O broker pode derrubar a conexao a qualquer momento (restart, deploy, rede).
// Sem isso, `channel` fica apontando pra um canal morto e toda publicacao/consumo
// seguinte falha com "Channel closed" ate o processo do backend ser reiniciado.
function handleConnectionDrop(reason: unknown) {
    logger.error({ error: reason }, 'Conexao com RabbitMQ perdida; agendando reconexao')
    connection = undefined
    channel = undefined
    scheduleReconnect()
}

// Tenta reconectar até conseguir, com backoff (5s, 10s, 20s... até 60s).
// Antes, uma falha na reconexão encerrava as tentativas e o backend ficava sem
// fila até ser reiniciado ("Canal do RabbitMQ nao inicializado" nos imports).
function scheduleReconnect() {
    if (reconnecting) return
    reconnecting = true

    const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS)

    setTimeout(async () => {
        try {
            await connectRabbitMQ()
            if (consuming) {
                await startConsumer()
            }
            reconnectAttempt = 0
            reconnecting = false
        } catch (err) {
            reconnectAttempt++
            logger.error(
                { error: err, attempt: reconnectAttempt },
                'Falha ao reconectar ao RabbitMQ; tentando novamente',
            )
            channel = undefined
            reconnecting = false
            scheduleReconnect()
        }
    }, delay)
}

/**
 * Conecta e inicia o consumidor. Se o broker estiver fora no boot, não desiste:
 * agenda reconexões em background e liga o consumidor quando voltar.
 */
export async function startQueueWithRetry(): Promise<void> {
    consuming = true
    try {
        await connectRabbitMQ()
        await startConsumer()
    } catch (err) {
        logger.warn({ error: err }, 'RabbitMQ indisponivel no boot; reconectando em background')
        channel = undefined
        scheduleReconnect()
    }
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

        const newConnection = await amqp.connect(RABBITMQ_URL)
        const newChannel = await newConnection.createChannel()

        // Respeita a topologia existente no broker sem mudar argumentos da fila principal.
        await newChannel.assertQueue(QUEUE_NAME, { durable: true })
        await newChannel.assertQueue(DLQ_NAME, { durable: true })

        if (typeof newChannel.prefetch === 'function') {
            newChannel.prefetch(1)
        }

        // 'error' é sempre seguido de 'close'; tratar só o close evita agendar
        // reconexão duas vezes. O listener de error fica pra não derrubar o processo.
        newConnection.on('error', (err) => logger.error({ error: err }, 'Erro na conexao com RabbitMQ'))
        newConnection.on('close', (err) => {
            if (connection === newConnection) handleConnectionDrop(err ?? 'connection closed')
        })

        // Só publica o canal depois que as filas existem.
        connection = newConnection
        channel = newChannel

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
        const result = await importJobRepository.registerAttempt(jobId, didFail)
        // Last row of the statement: leave a note in the bell (done or failed).
        if (result?.finishedNow) await notifyImportFinished(result.job)
    } catch (error) {
        logger.warn({ err: error, jobId, didFail }, 'Nao foi possivel atualizar progresso do ImportJob')
    }
}

export async function startConsumer() {
    consuming = true
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
