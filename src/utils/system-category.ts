import { TransactionCategory } from '@prisma/client'

/**
 * "Categoria de sistema" = os valores do enum TransactionCategory (SERVICES, SALARY,
 * HOUSING...). Elas não têm linha na tabela Category, então não têm id próprio —
 * uma transação está numa categoria de sistema quando categoryId é null e o enum
 * carrega a categoria. Pro MCP elas ganham um id sintético e estável
 * (`system:<ENUM>`) pra poderem aparecer em list_categories e serem usadas como
 * filtro (currentCategoryId), sem nunca colidir com um uuid de categoria real.
 */
export const SYSTEM_CATEGORY_ID_PREFIX = 'system:'

export const SYSTEM_CATEGORIES = Object.values(TransactionCategory) as TransactionCategory[]

export function toSystemCategoryId(category: TransactionCategory): string {
    return `${SYSTEM_CATEGORY_ID_PREFIX}${category}`
}

/** true pra qualquer id com o prefixo de sistema — mesmo que o enum seja inválido. */
export function isSystemCategoryId(id: string): boolean {
    return id.startsWith(SYSTEM_CATEGORY_ID_PREFIX)
}

/** Devolve o enum de um id de sistema válido, ou null se não for um (ou se o enum não existir). */
export function parseSystemCategoryId(id: string): TransactionCategory | null {
    if (!isSystemCategoryId(id)) return null

    const value = id.slice(SYSTEM_CATEGORY_ID_PREFIX.length)
    return SYSTEM_CATEGORIES.find((category) => category === value) ?? null
}

/**
 * Categorias de sistema não podem ser renomeadas, movidas, mescladas ou apagadas
 * (não são linhas do banco) — as tools que mexem na estrutura chamam isso antes
 * de qualquer lookup pra devolver um erro claro em vez de um "não encontrada".
 */
export function assertNotSystemCategoryId(id: string, action: string): void {
    if (isSystemCategoryId(id)) {
        throw new Error(
            `SYSTEM_CATEGORY: "${id}" é uma categoria de sistema e não pode ser ${action}. Só categorias personalizadas (ver list_categories, isSystem:false) podem.`,
        )
    }
}
