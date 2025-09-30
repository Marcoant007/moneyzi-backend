import { buildTransactionHandlerChain } from '@/core/handlers/build-transaction-handler'
import * as amqp from 'amqplib'
import { prisma } from '@/lib/prisma'

let channel: amqp.Channel
const QUEUE_NAME = 'csv_import'

export async function connectRabbitMQ() {
    const connection = await amqp.connect('amqp://localhost')
    channel = await connection.createChannel()
    await channel.assertQueue(QUEUE_NAME)
    console.log('✅ Conectado ao RabbitMQ')
}

export function publishToQueue(message: object) {
    if (!channel) throw new Error('Canal do RabbitMQ não inicializado.')
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
        persistent: true
    })
    console.log('📤 Mensagem publicada na fila')
}

export async function startConsumer() {
    if (!channel) throw new Error('Canal do RabbitMQ não inicializado.')

    channel.consume(QUEUE_NAME, async (msg) => {
        if (!msg) return

        const content = msg.content.toString()
        const data = JSON.parse(content)

        const chain = buildTransactionHandlerChain()
        try {
            await chain.handle(data)
            channel.ack(msg)
        } catch (err) {
            console.error('Erro processando mensagem da fila:', err)
            try {
                const jobId = data.importJobId as string | undefined
                if (jobId) {
                    await prisma.importJob.update({
                        where: { id: jobId },
                        data: { status: 'FAILED' },
                    })
                }
            } catch (e) {
                console.warn('Não foi possível atualizar ImportJob para FAILED:', e)
            }
            channel.ack(msg)
        }
    })

    console.log('👂 Consumidor escutando a fila http://localhost:15672')
}


