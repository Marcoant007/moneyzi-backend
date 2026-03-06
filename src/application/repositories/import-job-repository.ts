import type { ImportJob, ImportJobStatus } from '@prisma/client'

export interface ImportJobRepository {
    create(data: { 
        userId: string; 
        total: number; 
        processed?: number;
        creditCardId?: string;
        isCreditCardInvoice?: boolean;
    }): Promise<ImportJob>
    registerAttempt(id: string, didFail: boolean): Promise<ImportJob | null>
    markStatus(id: string, status: ImportJobStatus): Promise<void>
    findById(id: string): Promise<ImportJob | null>
}
