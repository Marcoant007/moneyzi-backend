import type { ImportJob, ImportJobStatus } from '@prisma/client'

export interface ImportJobRepository {
    create(data: { 
        userId: string; 
        total: number; 
        processed?: number;
        creditCardId?: string;
        isCreditCardInvoice?: boolean;
    }): Promise<ImportJob>
    /** Counts one processed row. finishedNow is true only for the attempt that
     *  brought processed up to total (so callers notify exactly once). */
    registerAttempt(id: string, didFail: boolean): Promise<{ job: ImportJob; finishedNow: boolean } | null>
    markStatus(id: string, status: ImportJobStatus): Promise<void>
    findById(id: string): Promise<ImportJob | null>
    delete(id: string, userId: string): Promise<boolean>
}
