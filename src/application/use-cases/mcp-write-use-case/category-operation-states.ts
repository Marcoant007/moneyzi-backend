/**
 * Formato do que as tools de reorganização de categorias gravam em
 * McpAuditLog.previousState/newState — é o contrato entre quem grava
 * (merge/rename/move/delete) e quem reverte (CategoryStructureRollback).
 *
 * Nenhum estado é `null`: a coluna é Json NOT NULL e o Prisma rejeita null
 * literal num campo Json obrigatório, então mesmo "sem estado" vira objeto.
 */

export const CATEGORY_STRUCTURE_TOOLS = ['merge_categories', 'delete_category', 'rename_category', 'move_category'] as const

export type CategoryStructureTool = (typeof CATEGORY_STRUCTURE_TOOLS)[number]

export function isCategoryStructureTool(tool: string): tool is CategoryStructureTool {
    return (CATEGORY_STRUCTURE_TOOLS as readonly string[]).includes(tool)
}

export interface CategorySnapshot {
    id: string
    name: string
    parentId: string | null
    /** ISO 8601 — JSON não tem Date. */
    createdAt: string
}

export function snapshotCategory(category: { id: string; name: string; parentId: string | null; createdAt: Date }): CategorySnapshot {
    return {
        id: category.id,
        name: category.name,
        parentId: category.parentId,
        createdAt: category.createdAt.toISOString(),
    }
}

/** merge_categories: antes = a origem apagada + o que apontava pra ela; depois = só o destino (o resto se deduz). */
export interface MergePreviousState {
    category: CategorySnapshot
    transactionIds: string[]
    childIds: string[]
}

export interface MergeNewState {
    targetId: string
}

export interface DeletePreviousState {
    category: CategorySnapshot
}

export interface DeleteNewState {
    deleted: true
}

export interface RenameState {
    id: string
    name: string
}

export interface MoveState {
    id: string
    parentId: string | null
}
