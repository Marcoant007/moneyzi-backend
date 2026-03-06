import { ImportJobStatus } from '@prisma/client'

interface ImportJobAttemptState {
    processed: number
    total: number
    status: ImportJobStatus
}

export function resolveImportJobAfterAttempt(
    job: ImportJobAttemptState,
    didFail: boolean,
): { processed: number; status: ImportJobStatus } {
    const nextProcessed = Math.min(job.processed + 1, job.total)
    const hasFailed = didFail || job.status === ImportJobStatus.FAILED
    const isFinished = nextProcessed >= job.total

    if (hasFailed) {
        return {
            processed: nextProcessed,
            status: ImportJobStatus.FAILED,
        }
    }

    return {
        processed: nextProcessed,
        status: isFinished ? ImportJobStatus.COMPLETED : ImportJobStatus.PROCESSING,
    }
}
