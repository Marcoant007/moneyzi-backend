export interface McpAuditLogEntry {
    id: string
    userId: string
    tool: string
    params: unknown
    previousState: unknown
    newState: unknown
    createdAt: Date
    rolledBackAt: Date | null
}

export interface CreateMcpAuditLogData {
    userId: string
    tool: string
    params: unknown
    previousState: unknown
    newState: unknown
}

export interface McpAuditLogRepository {
    create(data: CreateMcpAuditLogData): Promise<McpAuditLogEntry>
    /** Escopado ao userId — um usuário nunca enxerga/reverte a auditoria de outro. */
    findByIdForUser(id: string, userId: string): Promise<McpAuditLogEntry | null>
    markRolledBack(id: string): Promise<void>
}
