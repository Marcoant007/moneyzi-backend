function formatCurrency(amount: string | number): string {
    const value = typeof amount === 'number' ? amount : Number(amount)
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR')
}

function wrapLayout(userName: string, bodyHtml: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background-color:#0f1222;font-family:Arial,Helvetica,sans-serif;color:#e4e6f1;">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background-color:#171a2e;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="padding:24px;">
        <p style="margin:0 0 16px;font-size:14px;color:#9ca3af;">Olá, ${userName}</p>
        ${bodyHtml}
        <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">Moneyzi — controle financeiro</p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}

export function buildDueDateReminderEmail(params: {
    userName: string
    transactionName: string
    amount: string | number
    dueDate: Date
    daysUntilDue: number
}): { subject: string; html: string } {
    const { userName, transactionName, amount, dueDate, daysUntilDue } = params
    const dayLabel = daysUntilDue > 1 ? `${daysUntilDue} dias` : 'amanhã'

    return {
        subject: `Conta "${transactionName}" vence em ${dayLabel}`,
        html: wrapLayout(userName, `
          <p style="margin:0 0 8px;font-size:18px;font-weight:bold;color:#facc15;">Vencimento próximo</p>
          <p style="margin:0 0 4px;font-size:16px;">A conta <strong>${transactionName}</strong> de <strong>${formatCurrency(amount)}</strong> vence em <strong>${formatDate(dueDate)}</strong> (${dayLabel}).</p>
        `),
    }
}

export function buildOverdueEmail(params: {
    userName: string
    transactionName: string
    amount: string | number
    dueDate: Date
    daysOverdue: number
}): { subject: string; html: string } {
    const { userName, transactionName, amount, dueDate, daysOverdue } = params
    const dayLabel = `${daysOverdue} dia${daysOverdue > 1 ? 's' : ''}`

    return {
        subject: `Conta "${transactionName}" está vencida`,
        html: wrapLayout(userName, `
          <p style="margin:0 0 8px;font-size:18px;font-weight:bold;color:#f87171;">Conta vencida</p>
          <p style="margin:0 0 4px;font-size:16px;">A conta <strong>${transactionName}</strong> de <strong>${formatCurrency(amount)}</strong> venceu em <strong>${formatDate(dueDate)}</strong>, há ${dayLabel}.</p>
        `),
    }
}
