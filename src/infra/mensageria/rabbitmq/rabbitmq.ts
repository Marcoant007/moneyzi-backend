import * as amqp from 'amqplib'

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
        if (msg) {
            const content = msg.content.toString()
            console.log('📥 Mensagem recebida:', content)

            try {
                const data = JSON.parse(content)
                // Aqui você chama o processador de CSV
                // Ex: await processCsv(data)

                channel.ack(msg)
            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error)
                channel.nack(msg, false, false) // descarta a mensagem
            }
        }
    })

    console.log('👂 Consumidor escutando a fila')
}
