import type {
    CreateMcpAuditLogData,
    McpAuditLogEntry,
    McpAuditLogRepository,
} from '@/application/repositories/mcp-audit-log-repository'
import { prisma } from '@/lib/prisma'

export class PrismaMcpAuditLogRepository implements McpAuditLogRepository {
    async create(data: CreateMcpAuditLogData): Promise<McpAuditLogEntry> {
        return prisma.mcpAuditLog.create({
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
        return prisma.mcpAuditLog.findFirst({
            where: { id, userId },
        })
    }

    async markRolledBack(id: string): Promise<void> {
        await prisma.mcpAuditLog.update({
            where: { id },
            data: { rolledBackAt: new Date() },
        })
    }
}
