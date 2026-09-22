import * as z from 'zod-v4'
import { format } from 'date-fns'
import type { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import type { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import type { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case'
import type { ListAccountsUseCase } from '@/application/use-cases/account-use-case/list-accounts.use-case'
import type { GetCategoryMonthMatrixUseCase, MatrixRow } from '@/application/use-cases/dashboard-use-case/get-category-month-matrix.use-case'
import type { ListCategoriesUseCase } from '@/application/use-cases/category-use-case/list-categories.use-case'
import type { ListSystemCategoriesUseCase } from '@/application/use-cases/category-use-case/list-system-categories.use-case'
import type { CreateCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/create-category-for-mcp.use-case'
import type { CreateTransactionForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/create-transaction-for-mcp.use-case'
import type { MoveTransactionCategoryUseCase } from '@/application/use-cases/mcp-write-use-case/move-transaction-category.use-case'
import type { BulkMoveTransactionsUseCase, BulkMoveTarget } from '@/application/use-cases/mcp-write-use-case/bulk-move-transactions.use-case'
import type { MergeCategoriesUseCase } from '@/application/use-cases/mcp-write-use-case/merge-categories.use-case'
import type { RenameCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/rename-category-for-mcp.use-case'
import type { MoveCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/move-category-for-mcp.use-case'
import type { DeleteCategoryForMcpUseCase } from '@/application/use-cases/mcp-write-use-case/delete-category-for-mcp.use-case'
import type { RollbackOperationUseCase } from '@/application/use-cases/mcp-write-use-case/rollback-operation.use-case'
import { toSystemCategoryId } from '@/utils/system-category'

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
    listSystemCategoriesUseCase: ListSystemCategoriesUseCase
    createCategoryForMcpUseCase: CreateCategoryForMcpUseCase
    createTransactionForMcpUseCase: CreateTransactionForMcpUseCase
    moveTransactionCategoryUseCase: MoveTransactionCategoryUseCase
    bulkMoveTransactionsUseCase: BulkMoveTransactionsUseCase
    mergeCategoriesUseCase: MergeCategoriesUseCase
    renameCategoryForMcpUseCase: RenameCategoryForMcpUseCase
    moveCategoryForMcpUseCase: MoveCategoryForMcpUseCase
    deleteCategoryForMcpUseCase: DeleteCategoryForMcpUseCase
    rollbackOperationUseCase: RollbackOperationUseCase
}

const PAYMENT_METHODS = ['CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'BANK_SLIP', 'CASH', 'PIX', 'OTHER'] as const

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
                'Lista as transações (receitas e despesas) de um mês específico, com id, nome, categoria (nome e categoryId — o MESMO id de list_categories, inclusive "system:<NOME>" para categorias de sistema), valor, data e forma de pagamento. Use o id da transação para mover por lista explícita (move_transaction_category / bulk_move_transactions).',
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
                    id: t.id,
                    name: t.name,
                    type: t.type,
                    amount: t.amount,
                    category: t.categoryRef?.name ?? t.category,
                    // Casa com o id de list_categories: o da categoria personalizada,
                    // ou o id sintético da categoria de sistema quando não há uma.
                    categoryId: t.categoryId ?? toSystemCategoryId(t.category),
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
                'Retorna todas as categorias do usuário — as personalizadas (isSystem:false) e as de sistema (isSystem:true, ex.: SERVICES, SALARY, HOUSING, OTHER; id estável no formato "system:<NOME>") — com id, nome, categoria pai (se subcategoria) e quantas transações usam cada uma. Use antes de criar, mover, mesclar ou apagar categorias — é a fonte confiável de ids. As categorias de sistema servem como currentCategoryId em bulk_move_transactions, mas não podem ser renomeadas, movidas, mescladas nem apagadas.',
            inputSchema: {},
            execute: async () => {
                const [categories, systemCategories] = await Promise.all([
                    deps.listCategoriesUseCase.execute(userId),
                    deps.listSystemCategoriesUseCase.execute(userId),
                ])
                return {
                    categories: [
                        ...categories.map((c) => ({
                            id: c.id,
                            name: c.name,
                            parentId: c.parentId,
                            transactionCount: c.transactionCount,
                            isSystem: false,
                        })),
                        ...systemCategories,
                    ],
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
            name: 'create_transaction',
            description:
                'Cria um lançamento (transação) novo. categoryId sempre tem que ser uma categoria PERSONALIZADA existente (ver list_categories; categorias de sistema, com id "system:X", não são aceitas — crie/reaproveite uma personalizada com create_category primeiro). Se paymentMethod for CREDIT_CARD, creditCardId também é obrigatório. Nada é inferido silenciosamente: se faltar categoria, cartão ou qualquer campo obrigatório, pergunte ao usuário em vez de adivinhar. A operação fica auditada e pode ser desfeita com rollback_operation usando o operationId retornado. Requer token com escopo de escrita.',
            inputSchema: {
                name: z.string().min(1).describe('Nome/descrição do lançamento.'),
                amount: z.number().describe('Valor do lançamento. Despesas são positivas; só use negativo pra estorno/abatimento. Não pode ser zero.'),
                type: z.enum(['DEPOSIT', 'EXPENSE', 'INVESTMENT']).describe('Receita (DEPOSIT), despesa (EXPENSE) ou investimento (INVESTMENT).'),
                categoryId: z.string().describe('Id de uma categoria PERSONALIZADA (ver list_categories, ou crie uma nova com create_category). Categorias de sistema não são aceitas.'),
                paymentMethod: z.enum(PAYMENT_METHODS).describe('Forma de pagamento.'),
                date: z.string().describe('Data do lançamento (YYYY-MM-DD).'),
                accountId: z.string().optional().describe('Conta associada (ver get_accounts). Opcional — se informada, o lançamento é validado contra o saldo da conta.'),
                creditCardId: z.string().optional().describe('Cartão de crédito. Obrigatório quando paymentMethod é CREDIT_CARD.'),
                dueDate: z.string().optional().describe('Data de vencimento (YYYY-MM-DD), se houver.'),
                isRecurring: z.boolean().optional().describe('true se for um lançamento recorrente.'),
            },
            execute: async (args) => {
                const parsed = z.object({
                    name: z.string().min(1),
                    amount: z.number(),
                    type: z.enum(['DEPOSIT', 'EXPENSE', 'INVESTMENT']),
                    categoryId: z.string(),
                    paymentMethod: z.enum(PAYMENT_METHODS),
                    date: z.coerce.date(),
                    accountId: z.string().optional(),
                    creditCardId: z.string().optional(),
                    dueDate: z.coerce.date().optional(),
                    isRecurring: z.boolean().optional(),
                }).parse(args)

                return deps.createTransactionForMcpUseCase.execute({
                    userId,
                    name: parsed.name,
                    amount: parsed.amount,
                    type: parsed.type,
                    categoryId: parsed.categoryId,
                    paymentMethod: parsed.paymentMethod,
                    date: parsed.date,
                    accountId: parsed.accountId ?? null,
                    creditCardId: parsed.creditCardId ?? null,
                    dueDate: parsed.dueDate ?? null,
                    isRecurring: parsed.isRecurring ?? false,
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
                'Reclassifica VÁRIAS transações de uma vez pra outra categoria. ESTA FERRAMENTA EXIGE DUAS CHAMADAS: primeiro com dryRun (padrão true) pra revisar exatamente quais transações seriam afetadas e receber um confirmationToken; depois uma segunda chamada com dryRun:false e o MESMO confirmationToken pra executar de verdade. Nunca pule a etapa de revisão — uma chamada sem confirmationToken nunca altera nada. O dry-run devolve o total de transações afetadas (count) e a lista das primeiras (id, nome, valor, data e categoria atual); se passar de previewLimit, só as primeiras são listadas, mas o total é sempre o count. Se o conjunto de transações mudar entre as duas chamadas (ex: chegou uma transação nova), a confirmação é rejeitada e pede um novo dry-run. Limite de 500 transações por chamada (limitReached:true avisa que pode haver mais). Entre campos diferentes do filter vale AND; nameContainsAny é OR entre os termos. Requer token com escopo de escrita.',
            inputSchema: {
                transactionIds: z.array(z.string()).optional().describe('Lista explícita de ids de transação (ver list_transactions). Use isso OU filter, não os dois.'),
                filter: z.object({
                    nameContains: z.string().optional().describe('Filtra por transações cujo nome contém esse texto.'),
                    nameContainsAny: z.array(z.string().min(1)).min(1).max(20).optional().describe('Filtra por transações cujo nome contém QUALQUER um destes textos (OR, sem diferenciar maiúsculas/minúsculas).'),
                    currentCategoryId: z.string().optional().describe('Filtra por transações que estão atualmente nessa categoria: id de categoria personalizada ou de sistema ("system:SERVICES" etc., ver list_categories).'),
                    paymentMethod: z.enum(PAYMENT_METHODS).optional().describe('Filtra pela forma de pagamento.'),
                    type: z.enum(['EXPENSE', 'DEPOSIT']).optional().describe('Filtra por despesa (EXPENSE) ou receita (DEPOSIT).'),
                    amountMin: z.number().optional().describe('Valor mínimo, inclusive (como armazenado: despesas são positivas).'),
                    amountMax: z.number().optional().describe('Valor máximo, inclusive (como armazenado: despesas são positivas).'),
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
                        nameContainsAny: z.array(z.string()).max(20).optional(),
                        currentCategoryId: z.string().optional(),
                        paymentMethod: z.enum(PAYMENT_METHODS).optional(),
                        type: z.enum(['EXPENSE', 'DEPOSIT']).optional(),
                        amountMin: z.number().optional(),
                        amountMax: z.number().optional(),
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
            name: 'merge_categories',
            description:
                'Junta duas categorias personalizadas: move TODAS as transações da categoria de origem (sourceId) para a de destino (targetId), reaponta as subcategorias da origem para o destino e depois APAGA a origem — tudo numa única transação de banco. ESTA FERRAMENTA EXIGE DUAS CHAMADAS: primeiro com dryRun (padrão true) pra revisar exatamente o que seria afetado (total de transações, subcategorias reapontadas e conflitos de nome) e receber um confirmationToken; depois uma segunda chamada com dryRun:false e o MESMO confirmationToken pra executar de verdade. Nunca pule a etapa de revisão — uma chamada sem confirmationToken nunca altera nada. Se uma subcategoria da origem tiver o mesmo nome de uma subcategoria do destino, o dry-run lista o conflito (canExecute:false) e NÃO emite token: resolva antes com rename_category ou move_category. Se o conjunto afetado mudar entre as duas chamadas (ex: chegou uma transação nova), a confirmação é rejeitada e pede um novo dry-run. Recusa origem igual ao destino, destino dentro da origem (ciclo) e resultado com mais de 3 níveis de profundidade. A operação fica auditada e pode ser desfeita com rollback_operation (recria a origem com o MESMO id). Requer token com escopo de escrita.',
            inputSchema: {
                sourceId: z.string().describe('Id da categoria de origem — ela será APAGADA no final (ver list_categories).'),
                targetId: z.string().describe('Id da categoria de destino — recebe as transações e subcategorias da origem (ver list_categories).'),
                dryRun: z.boolean().optional().describe('true (padrão) só mostra o que seria afetado e gera um confirmationToken, sem alterar nada. false executa de verdade e exige confirmationToken.'),
                confirmationToken: z.string().optional().describe('Token retornado pelo dry-run anterior. Obrigatório quando dryRun:false.'),
            },
            execute: async (args) => {
                const parsed = z.object({
                    sourceId: z.string(),
                    targetId: z.string(),
                    dryRun: z.boolean().optional(),
                    confirmationToken: z.string().optional(),
                }).parse(args)

                const dryRun = parsed.dryRun ?? true

                if (dryRun) {
                    return deps.mergeCategoriesUseCase.dryRun(userId, parsed.sourceId, parsed.targetId)
                }

                if (!parsed.confirmationToken) {
                    throw new Error('dryRun:false exige confirmationToken (retornado por uma chamada anterior com dryRun:true).')
                }

                return deps.mergeCategoriesUseCase.confirm(userId, parsed.confirmationToken, parsed.sourceId, parsed.targetId)
            },
        },
        {
            name: 'rename_category',
            description:
                'Renomeia uma categoria personalizada imediatamente (sem dry-run). Aplica trim no nome — categorias antigas com espaço no final ficam limpas. Rejeita se já existir outra categoria com o mesmo nome (sem diferenciar maiúsculas/minúsculas) sob o mesmo pai. Categorias de sistema (isSystem:true) não podem ser renomeadas. A mudança fica auditada e pode ser desfeita com rollback_operation usando o operationId retornado. Requer token com escopo de escrita.',
            inputSchema: {
                categoryId: z.string().describe('Id da categoria a renomear (ver list_categories).'),
                newName: z.string().min(1).max(100).describe('Novo nome da categoria.'),
            },
            execute: async (args) => {
                const parsed = z.object({ categoryId: z.string(), newName: z.string() }).parse(args)
                return deps.renameCategoryForMcpUseCase.execute({
                    userId,
                    categoryId: parsed.categoryId,
                    newName: parsed.newName,
                })
            },
        },
        {
            name: 'move_category',
            description:
                'Move uma categoria personalizada (com todas as suas subcategorias) pra baixo de outra categoria imediatamente (sem dry-run), ou a transforma em categoria raiz com newParentId:null. Recusa se criaria um ciclo, se a árvore passaria de 3 níveis contando as subcategorias que vão junto, ou se já existir uma categoria com o mesmo nome sob o novo pai. A mudança fica auditada e pode ser desfeita com rollback_operation usando o operationId retornado. Requer token com escopo de escrita.',
            inputSchema: {
                categoryId: z.string().describe('Id da categoria a mover (ver list_categories).'),
                newParentId: z.string().nullable().describe('Id da nova categoria pai, ou null pra transformar em categoria raiz. Obrigatório (passe null explicitamente pra raiz).'),
            },
            execute: async (args) => {
                const parsed = z.object({ categoryId: z.string(), newParentId: z.string().nullable() }).parse(args)
                return deps.moveCategoryForMcpUseCase.execute({
                    userId,
                    categoryId: parsed.categoryId,
                    newParentId: parsed.newParentId,
                })
            },
        },
        {
            name: 'delete_category',
            description:
                'Apaga uma categoria personalizada VAZIA imediatamente (sem dry-run): só funciona se ela não tiver nenhuma transação, nenhuma subcategoria e nenhuma outra referência. Se tiver, devolve um erro explicando o motivo e o que fazer — mover as transações/subcategorias (move_transaction_category, bulk_move_transactions, move_category) ou juntar tudo em outra categoria com merge_categories. A mudança fica auditada e pode ser desfeita com rollback_operation (recria a categoria com o MESMO id). Requer token com escopo de escrita.',
            inputSchema: {
                categoryId: z.string().describe('Id da categoria a apagar (ver list_categories).'),
            },
            execute: async (args) => {
                const { categoryId } = z.object({ categoryId: z.string() }).parse(args)
                return deps.deleteCategoryForMcpUseCase.execute({ userId, categoryId })
            },
        },
        {
            name: 'rollback_operation',
            description:
                'Reverte uma operação de escrita anterior (create_category, create_transaction, move_transaction_category, bulk_move_transactions, merge_categories, rename_category, move_category ou delete_category) usando o operationId retornado por ela, restaurando o estado anterior salvo em auditoria. create_transaction é revertido apagando a transação criada. merge_categories e delete_category recriam a categoria apagada com o MESMO id (o merge também devolve as subcategorias e as transações que moveu). Transações e subcategorias que foram alteradas de novo depois da operação original são puladas (nunca sobrescreve uma mudança posterior) e reportadas na resposta. Se o estado atual impedir a restauração (categoria pai original apagada, nome já ocupado, profundidade), o rollback falha com o motivo e não altera nada. Requer token com escopo de escrita.',
            inputSchema: {
                operationId: z.string().describe('Id da operação a reverter (retornado por create_category, create_transaction, move_transaction_category, bulk_move_transactions, merge_categories, rename_category, move_category ou delete_category).'),
            },
            execute: async (args) => {
                const { operationId } = z.object({ operationId: z.string() }).parse(args)
                return deps.rollbackOperationUseCase.execute(userId, operationId)
            },
        },
    ]

    return [...readOnlyTools, ...writeTools]
}
