import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'

export interface CategoryUnitOfWorkContext {
    categoryRepository: CategoryRepository
    mcpAuditLogRepository: McpAuditLogRepository
}

/**
 * Executa `work` dentro de UMA transação de banco: os repositórios do contexto
 * enxergam e gravam na mesma transação. Se `work` lançar, nada é gravado —
 * nem a mudança nem a auditoria. É o que garante que uma reorganização de
 * categorias (merge, delete...) nunca fica pela metade nem sem operationId.
 */
export interface CategoryUnitOfWork {
    run<T>(work: (context: CategoryUnitOfWorkContext) => Promise<T>): Promise<T>
}
