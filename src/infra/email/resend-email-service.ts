import { Resend } from 'resend'
import logger from '@/lib/logger'

let client: Resend | undefined

function getClient(): Resend {
    if (!client) {
        const apiKey = process.env.RESEND_API_KEY
        if (!apiKey) {
            throw new Error('RESEND_API_KEY environment variable is required')
        }
        client = new Resend(apiKey)
    }
    return client
}

const EMAIL_FROM = process.env.EMAIL_FROM || 'Moneyzi <notificacoes@moneyzi.app>'

// Envio de email best-effort: erros sao logados mas nunca propagados, para que uma
// falha no Resend (ou RESEND_API_KEY ausente) nunca derrube um job de notificacao
// que ja criou a notificacao in-app com sucesso.
export async function sendEmail(params: {
    to: string
    subject: string
    html: string
}): Promise<void> {
    try {
        const { error } = await getClient().emails.send({
            from: EMAIL_FROM,
            to: params.to,
            subject: params.subject,
            html: params.html,
        })

        if (error) {
            logger.error({ error, to: params.to, subject: params.subject }, 'Falha ao enviar email via Resend')
        }
    } catch (err) {
        logger.error({ err, to: params.to, subject: params.subject }, 'Erro ao enviar email')
    }
}
