import * as z from 'zod-v4'
import { format } from 'date-fns'
import type { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import type { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import type { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case'
import type { ListAccountsUseCase } from '@/application/use-cases/account-use-case/list-accounts.use-case'
import type { GetCategoryMonthMatrixUseCase, MatrixRow } from '@/application/use-cases/dashboard-use-case/get-category-month-matrix.use-case'
import type { ListCategoriesUseCase } from '@/application/use-cases/category-use-case/list-categories.use-case'
import type { CreateCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/create-category-for-mcp.use-case'
import type { MoveTransactionCategoryUseCase } from '@/application/use-cases/mcp-write-use-case/move-transaction-category.use-case'
import type { BulkMoveTransactionsUseCase, BulkMoveTarget } from '@/application/use-cases/mcp-write-use-case/bulk-move-transactions.use-case'
import type { RollbackOperationUseCase } from '@/application/use-cases/mcp-write-use-case/rollback-operation.use-case'

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
    scope: string
    getMonthlySummaryUseCase: GetMonthlySummaryUseCase
    listTransactionsUseCase: ListTransactionsUseCase
    getPayablesReceivablesUseCase: GetPayablesReceivablesUseCase
    listAccountsUseCase: ListAccountsUseCase
    getCategoryMonthMatrixUseCase: GetCategoryMonthMatrixUseCase
    listCategoriesUseCase: ListCategoriesUseCase
    createCategoryForMcpUseCase: CreateCategoryForMcpUseCase
    moveTransactionCategoryUseCase: MoveTransactionCategoryUseCase
    bulkMoveTransactionsUseCase: BulkMoveTransactionsUseCase
    rollbackOperationUseCase: RollbackOperationUseCase
}

function rowToByMonth(row: MatrixRow, months: string[]) {
    return {
        category: row.name,
        depth: row.depth,
        byMonth: Object.fromEntries(months.map((m, i) => [m, row.monthlyTotals[i]])),
    }
}

export function buildMcpTools(deps: McpToolsDeps): McpToolDefinition[] {
    const { userId } = deps

    const readOnlyTools: McpToolDefinition[] = [
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
        {
            name: 'get_category_totals_by_month',
            description:
                'Retorna o total de despesas e de receitas por categoria, mês a mês, ao longo de um ano inteiro (subcategorias já somadas dentro da categoria principal). Use para perguntas que cruzam vários meses, tipo "qual categoria eu mais gastei nos últimos meses", "como evoluiu meu gasto com X esse ano" ou "meu aluguel subiu?".',
            inputSchema: {
                year: z.number().int().min(2000).max(2100).optional().describe('Ano (ex: 2026). Se omitido, usa o ano atual.'),
            },
            execute: async (args) => {
                const { year } = z.object({ year: z.number().int().optional() }).parse(args)
                const result = await deps.getCategoryMonthMatrixUseCase.execute({
                    userId,
                    year: year ?? new Date().getFullYear(),
                })

                return {
                    months: result.months,
                    monthlyBalance: Object.fromEntries(result.months.map((m, i) => [m, result.balance[i]])),
                    expenseByCategory: result.expense.rows
                        .filter((row) => !row.isLegacy)
                        .map((row) => rowToByMonth(row, result.months)),
                    incomeByCategory: result.income.rows
                        .filter((row) => !row.isLegacy)
                        .map((row) => rowToByMonth(row, result.months)),
                }
            },
        },
        {
            name: 'list_categories',
            description:
                'Retorna todas as categorias personalizadas do usuário, com id, nome, categoria pai (se subcategoria) e quantas transações usam cada uma. Use antes de criar ou mover categorias — é a fonte confiável de ids, já que as transações trazem o nome da categoria mas não um id garantido.',
            inputSchema: {},
            execute: async () => {
                const categories = await deps.listCategoriesUseCase.execute(userId)
                return {
                    categories: categories.map((c) => ({
                        id: c.id,
                        name: c.name,
                        parentId: c.parentId,
                        transactionCount: c.transactionCount,
                    })),
                }
            },
        },
    ]

    if (deps.scope !== 'read_write') {
        return readOnlyTools
    }

    const writeTools: McpToolDefinition[] = [
        {
            name: 'create_category',
            description:
                'Cria uma categoria personalizada nova. Se já existir uma categoria com o mesmo nome sob o mesmo pai, devolve a categoria existente em vez de duplicar — não é erro chamar de novo com um nome que já existe. Requer token com escopo de escrita.',
            inputSchema: {
                name: z.string().min(1).max(100).describe('Nome da categoria.'),
                parentId: z.string().optional().describe('Id de uma categoria já existente pra criar como subcategoria dela. Máximo de 3 níveis de profundidade.'),
            },
            execute: async (args) => {
                const parsed = z.object({ name: z.string(), parentId: z.string().optional() }).parse(args)
                return deps.createCategoryForMcpUseCase.execute({
                    userId,
                    name: parsed.name,
                    parentId: parsed.parentId ?? null,
                })
            },
        },
        {
            name: 'move_transaction_category',
            description:
                'Reclassifica UMA transação pra outra categoria imediatamente (sem dry-run — pra várias transações de uma vez, use bulk_move_transactions). A mudança fica auditada e pode ser desfeita com rollback_operation usando o operationId retornado. Requer token com escopo de escrita.',
            inputSchema: {
                transactionId: z.string().describe('Id da transação a reclassificar.'),
                newCategoryId: z.string().describe('Id da categoria de destino (ver list_categories).'),
            },
            execute: async (args) => {
                const parsed = z.object({ transactionId: z.string(), newCategoryId: z.string() }).parse(args)
                return deps.moveTransactionCategoryUseCase.execute({
                    userId,
                    transactionId: parsed.transactionId,
                    newCategoryId: parsed.newCategoryId,
                })
            },
        },
        {
            name: 'bulk_move_transactions',
            description:
                'Reclassifica VÁRIAS transações de uma vez pra outra categoria. ESTA FERRAMENTA EXIGE DUAS CHAMADAS: primeiro com dryRun (padrão true) pra revisar exatamente quais transações seriam afetadas e receber um confirmationToken; depois uma segunda chamada com dryRun:false e o MESMO confirmationToken pra executar de verdade. Nunca pule a etapa de revisão — uma chamada sem confirmationToken nunca altera nada. Se o conjunto de transações mudar entre as duas chamadas (ex: chegou uma transação nova), a confirmação é rejeitada e pede um novo dry-run. Limite de 500 transações por chamada. Requer token com escopo de escrita.',
            inputSchema: {
                transactionIds: z.array(z.string()).optional().describe('Lista explícita de ids de transação. Use isso OU filter, não os dois.'),
                filter: z.object({
                    nameContains: z.string().optional().describe('Filtra por transações cujo nome contém esse texto.'),
                    currentCategoryId: z.string().optional().describe('Filtra por transações que estão atualmente nessa categoria.'),
                    dateFrom: z.string().optional().describe('Data inicial (YYYY-MM-DD), inclusive.'),
                    dateTo: z.string().optional().describe('Data final (YYYY-MM-DD), inclusive.'),
                }).optional().describe('Filtro pra resolver quais transações afetar, alternativa a transactionIds.'),
                newCategoryId: z.string().describe('Id da categoria de destino (ver list_categories).'),
                dryRun: z.boolean().optional().describe('true (padrão) só mostra o preview e gera um confirmationToken, sem alterar nada. false executa de verdade e exige confirmationToken.'),
                confirmationToken: z.string().optional().describe('Token retornado pelo dry-run anterior. Obrigatório quando dryRun:false.'),
            },
            execute: async (args) => {
                const parsed = z.object({
                    transactionIds: z.array(z.string()).optional(),
                    filter: z.object({
                        nameContains: z.string().optional(),
                        currentCategoryId: z.string().optional(),
                        dateFrom: z.string().optional(),
                        dateTo: z.string().optional(),
                    }).optional(),
                    newCategoryId: z.string(),
                    dryRun: z.boolean().optional(),
                    confirmationToken: z.string().optional(),
                }).parse(args)

                const target: BulkMoveTarget = { transactionIds: parsed.transactionIds, filter: parsed.filter }
                const dryRun = parsed.dryRun ?? true

                if (dryRun) {
                    return deps.bulkMoveTransactionsUseCase.dryRun(userId, target, parsed.newCategoryId)
                }

                if (!parsed.confirmationToken) {
                    throw new Error('dryRun:false exige confirmationToken (retornado por uma chamada anterior com dryRun:true).')
                }

                return deps.bulkMoveTransactionsUseCase.confirm(userId, parsed.confirmationToken, target, parsed.newCategoryId)
            },
        },
        {
            name: 'rollback_operation',
            description:
                'Reverte uma operação de escrita anterior (create_category, move_transaction_category ou bulk_move_transactions) usando o operationId retornado por ela, restaurando o estado anterior salvo em auditoria. Transações que foram alteradas manualmente de novo depois da operação original são puladas (nunca sobrescreve uma mudança posterior) e reportadas na resposta. Requer token com escopo de escrita.',
            inputSchema: {
                operationId: z.string().describe('Id da operação a reverter (retornado por create_category, move_transaction_category ou bulk_move_transactions).'),
            },
            execute: async (args) => {
                const { operationId } = z.object({ operationId: z.string() }).parse(args)
                return deps.rollbackOperationUseCase.execute(userId, operationId)
            },
        },
    ]

    return [...readOnlyTools, ...writeTools]
}
