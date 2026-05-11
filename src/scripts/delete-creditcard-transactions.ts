import { PrismaClient } from '@prisma/client'

/**
 * Remove todas as transações vinculadas a cartão de crédito do mês atual.
 *
 * Uso:
 *   pnpm ts-node -r tsconfig-paths/register src/scripts/delete-creditcard-transactions.ts
 *
 * Flags opcionais:
 *   --confirm       Executa a exclusão (sem essa flag só lista o que seria excluído)
 *   --userId=<id>   Filtra por usuário específico
 *   --month=<1-12>  Mês alvo (padrão: mês atual)
 *   --year=<yyyy>   Ano alvo  (padrão: ano atual)
 */

const prisma = new PrismaClient()

function parseArgs() {
    const args = process.argv.slice(2)
    const confirm = args.includes('--confirm')

    const userIdArg = args.find((a) => a.startsWith('--userId='))
    const monthArg = args.find((a) => a.startsWith('--month='))
    const yearArg = args.find((a) => a.startsWith('--year='))

    const now = new Date()
    const month = monthArg ? parseInt(monthArg.split('=')[1]) : now.getMonth() + 1
    const year = yearArg ? parseInt(yearArg.split('=')[1]) : now.getFullYear()
    const userId = userIdArg ? userIdArg.split('=')[1] : undefined

    return { confirm, userId, month, year }
}

async function main() {
    const { confirm, userId, month, year } = parseArgs()

    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)

    console.log(`\nAlvo: ${String(month).padStart(2, '0')}/${year}`)
    console.log(`Periodo: ${start.toLocaleDateString('pt-BR')} ate ${new Date(end.getTime() - 1).toLocaleDateString('pt-BR')}`)
    if (userId) console.log(`Usuario: ${userId}`)
    console.log(`Modo: ${confirm ? 'EXCLUSAO REAL' : 'DRY RUN (use --confirm para excluir de verdade)'}`)
    console.log('---')

    const where = {
        creditCardId: { not: null as string | null },
        deletedAt: null,
        ...(userId ? { userId } : {}),
        OR: [
            { dueDate: { gte: start, lt: end } },
            { dueDate: null, date: { gte: start, lt: end } },
        ],
    }

    const transactions = await prisma.transaction.findMany({
        where,
        select: {
            id: true,
            name: true,
            amount: true,
            date: true,
            dueDate: true,
            userId: true,
            creditCard: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
    })

    if (transactions.length === 0) {
        console.log('Nenhuma transacao de cartao encontrada para o periodo.')
        return
    }

    console.log(`Encontradas ${transactions.length} transacoes:\n`)

    const byCard: Record<string, typeof transactions> = {}
    for (const t of transactions) {
        const cardName = t.creditCard?.name ?? 'Sem cartao'
        if (!byCard[cardName]) byCard[cardName] = []
        byCard[cardName].push(t)
    }

    for (const [cardName, items] of Object.entries(byCard)) {
        const total = items.reduce((sum, t) => sum + Number(t.amount), 0)
        console.log(`Cartao: ${cardName} — ${items.length} transacoes — Total: R$ ${total.toFixed(2)}`)
        for (const t of items) {
            const date = new Date(t.date).toLocaleDateString('pt-BR')
            console.log(`  [${date}] ${t.name.slice(0, 50).padEnd(50)} R$ ${Number(t.amount).toFixed(2)}`)
        }
        console.log('')
    }

    if (!confirm) {
        console.log('Dry run concluido. Rode com --confirm para excluir.')
        return
    }

    const ids = transactions.map((t) => t.id)

    // Hard delete — remove permanentemente do banco
    const result = await prisma.transaction.deleteMany({
        where: { id: { in: ids } },
    })

    console.log(`Excluidas ${result.count} transacoes com sucesso.`)
}

main()
    .catch((err) => {
        console.error('Erro:', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
