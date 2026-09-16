import * as z from 'zod-v4'
import { format } from 'date-fns'
import type { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import type { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import type { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case'
import type { ListAccountsUseCase } from '@/application/use-cases/account-use-case/list-accounts.use-case'

/**
 * Servidor pessoal: existe um único dono (MCP_OWNER_USER_ID), então cada tool
 * usa esse userId fixo — nunca um valor vindo do modelo/cliente MCP.
 */
export interface McpToolDefinition {
    name: string
    description: string
    inputSchema: z.ZodRawShape
    execute: (args: unknown) => Promise<unknown>
}

function currentPeriod(): string {
    return format(new Date(), 'yyyy-MM')
}

function currentMonthYear(): { month: number; year: number } {
    const now = new Date()
    return { month: now.getMonth() + 1, year: now.getFullYear() }
}

interface McpToolsDeps {
    userId: string
    getMonthlySummaryUseCase: GetMonthlySummaryUseCase
    listTransactionsUseCase: ListTransactionsUseCase
    getPayablesReceivablesUseCase: GetPayablesReceivablesUseCase
    listAccountsUseCase: ListAccountsUseCase
}

export function buildMcpTools(deps: McpToolsDeps): McpToolDefinition[] {
    const { userId } = deps

    return [
        {
            name: 'get_monthly_summary',
            description:
                'Retorna o resumo financeiro de um mês: receita, despesas, saldo, gastos fixos vs variáveis, análise de cartão de crédito, maiores categorias de gasto e a regra 50/30/20.',
            inputSchema: {
                period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('Mês no formato YYYY-MM. Se omitido, usa o mês atual.'),
            },
            execute: async (args) => {
                const { period } = z.object({ period: z.string().optional() }).parse(args)
                return deps.getMonthlySummaryUseCase.execute(userId, period ?? currentPeriod())
            },
        },
        {
            name: 'list_transactions',
            description:
                'Lista as transações (receitas e despesas) de um mês específico, com nome, categoria, valor, data e forma de pagamento.',
            inputSchema: {
                month: z.number().int().min(1).max(12).optional().describe('Mês (1-12). Se omitido, usa o mês atual.'),
                year: z.number().int().min(2000).max(2100).optional().describe('Ano (ex: 2026). Se omitido, usa o ano atual.'),
                accountId: z.string().optional().describe('Filtra por uma conta específica.'),
            },
            execute: async (args) => {
                const parsed = z
                    .object({
                        month: z.number().int().optional(),
                        year: z.number().int().optional(),
                        accountId: z.string().optional(),
                    })
                    .parse(args)
                const fallback = currentMonthYear()

                const transactions = await deps.listTransactionsUseCase.execute({
                    userId,
                    month: parsed.month ?? fallback.month,
                    year: parsed.year ?? fallback.year,
                    accountId: parsed.accountId,
                })

                return transactions.map((t) => ({
                    name: t.name,
                    type: t.type,
                    amount: t.amount,
                    category: t.categoryRef?.name ?? t.category,
                    date: t.date,
                    paymentMethod: t.paymentMethod,
                    account: t.account?.name ?? null,
                }))
            },
        },
        {
            name: 'get_payables_receivables',
            description:
                'Retorna contas a pagar e a receber (incluindo faturas de cartão em aberto), com status de pagamento (pago, pendente, atrasado), data de vencimento e a projeção líquida do período. Chame sem "month"/"year" para ver todas as contas pendentes/atrasadas de qualquer período — é a forma certa de responder "o que vence em breve" ou "o que está atrasado".',
            inputSchema: {
                month: z.number().int().min(1).max(12).optional().describe('Mês (1-12). Se omitido, considera todos os períodos.'),
                year: z.number().int().min(2000).max(2100).optional().describe('Ano (ex: 2026). Se omitido, considera todos os períodos.'),
            },
            execute: async (args) => {
                const parsed = z
                    .object({
                        month: z.number().int().optional(),
                        year: z.number().int().optional(),
                    })
                    .parse(args)

                return deps.getPayablesReceivablesUseCase.execute({
                    userId,
                    month: parsed.month,
                    year: parsed.year,
                })
            },
        },
        {
            name: 'get_accounts',
            description:
                'Retorna todas as contas do usuário (corrente, poupança, investimento, dinheiro, cofrinho, outra) com o saldo atual de cada uma e o saldo total. Use para responder perguntas sobre quanto está investido, saldo em conta corrente/poupança, ou patrimônio total em contas.',
            inputSchema: {},
            execute: async () => {
                return deps.listAccountsUseCase.execute(userId)
            },
        },
    ]
}
