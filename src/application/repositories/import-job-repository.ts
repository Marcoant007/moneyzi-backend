import type { ImportJob, ImportJobStatus } from '@prisma/client'

export interface ImportJobRepository {
    create(data: { userId: string; total: number; processed?: number }): Promise<ImportJob>
    incrementProcessed(id: string): Promise<ImportJob>
    markStatus(id: string, status: ImportJobStatus): Promise<void>
    findById(id: string): Promise<ImportJob | null>
}
