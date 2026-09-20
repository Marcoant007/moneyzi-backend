import type {
    CreateMcpAuditLogData,
    McpAuditLogEntry,
    McpAuditLogRepository,
} from '@/application/repositories/mcp-audit-log-repository'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

/**
 * Sem argumento usa o cliente global. A CategoryUnitOfWork passa o cliente de
 * uma transação pra que a auditoria seja gravada junto com a mudança que ela
 * descreve — nunca existe alteração sem operationId nem operationId sem alteração.
 */
export class PrismaMcpAuditLogRepository implements McpAuditLogRepository {
    constructor(private readonly client: Prisma.TransactionClient = prisma) { }

    async create(data: CreateMcpAuditLogData): Promise<McpAuditLogEntry> {
        return this.client.mcpAuditLog.create({
            data: {
                userId: data.userId,
                tool: data.tool,
                params: data.params as any,
                previousState: data.previousState as any,
                newState: data.newState as any,
            },
        })
    }

    async findByIdForUser(id: string, userId: string): Promise<McpAuditLogEntry | null> {
        return this.client.mcpAuditLog.findFirst({
            where: { id, userId },
        })
    }

    async markRolledBack(id: string): Promise<void> {
        await this.client.mcpAuditLog.update({
            where: { id },
            data: { rolledBackAt: new Date() },
        })
    }
}
