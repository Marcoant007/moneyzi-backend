import 'dotenv/config'
import { Resend } from 'resend'

async function main() {
    const to = process.argv[2]
    if (!to) {
        console.error('Uso: npx ts-node -r tsconfig-paths/register scripts/test-resend-email.ts seu@email.com')
        process.exit(1)
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
        console.error('RESEND_API_KEY nao esta definida no ambiente (.env local).')
        process.exit(1)
    }

    const from = process.env.EMAIL_FROM || 'Moneyzi <notificacoes@moneyzi.com.br>'
    const resend = new Resend(apiKey)

    const result = await resend.emails.send({
        from,
        to,
        subject: 'Teste Moneyzi - Resend',
        html: '<p>Se voce recebeu isso, o Resend esta funcionando.</p>',
    })

    console.log(JSON.stringify(result, null, 2))
}

main()
