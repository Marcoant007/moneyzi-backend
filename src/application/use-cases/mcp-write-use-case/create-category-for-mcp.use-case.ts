import type { CategoryRepository } from '@/application/repositories/category-repository'
import type { McpAuditLogRepository } from '@/application/repositories/mcp-audit-log-repository'
import { CreateCategoryUseCase } from '@/application/use-cases/category-use-case/create-category.use-case'

export interface CreateCategoryForMcpInput {
    userId: string
    name: string
    parentId?: string | null
}

export interface CreateCategoryForMcpResult {
    id: string
    name: string
    parentId: string | null
    createdAt: Date
    alreadyExisted: boolean
    operationId: string | null
}

/**
 * Nunca duplica: se já existe uma categoria com esse nome (case-insensitive)
 * sob o mesmo pai, devolve ela em vez de criar de novo ou dar erro — melhor
 * pra um agente de IA, que não precisa tratar "já existe" como falha.
 */
export class CreateCategoryForMcpUseCase {
    constructor(
        private readonly categoryRepository: CategoryRepository,
        private readonly createCategoryUseCase: CreateCategoryUseCase,
        private readonly mcpAuditLogRepository: McpAuditLogRepository,
    ) { }

    async execute(input: CreateCategoryForMcpInput): Promise<CreateCategoryForMcpResult> {
        const name = input.name.trim()
        const parentId = input.parentId ?? null

        const existing = await this.categoryRepository.findByNameAndParent(input.userId, name, parentId)
        if (existing) {
            return {
                id: existing.id,
                name: existing.name,
                parentId: existing.parentId,
                createdAt: existing.createdAt,
                alreadyExisted: true,
                operationId: null,
            }
        }

        const created = await this.createCategoryUseCase.execute({ name, userId: input.userId, parentId })

        const auditLog = await this.mcpAuditLogRepository.create({
            userId: input.userId,
            tool: 'create_category',
            params: { name, parentId },
            previousState: null,
            newState: { id: created.id, name: created.name, parentId: created.parentId },
        })

        return {
            id: created.id,
            name: created.name,
            parentId: created.parentId,
            createdAt: created.createdAt,
            alreadyExisted: false,
            operationId: auditLog.id,
        }
    }
}
