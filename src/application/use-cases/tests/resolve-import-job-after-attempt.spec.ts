import { describe, expect, it } from 'vitest'
import { ImportJobStatus } from '@prisma/client'
import { resolveImportJobAfterAttempt } from '@/application/use-cases/import-use-case/resolve-import-job-after-attempt'

describe('resolveImportJobAfterAttempt', () => {
    it('keeps the job processing while there are pending items and no failures', () => {
        const result = resolveImportJobAfterAttempt({
            processed: 1,
            total: 3,
            status: ImportJobStatus.PROCESSING,
        }, false)

        expect(result).toEqual({
            processed: 2,
            status: ImportJobStatus.PROCESSING,
        })
    })

    it('marks the job as completed on the last successful outcome', () => {
        const result = resolveImportJobAfterAttempt({
            processed: 2,
            total: 3,
            status: ImportJobStatus.PROCESSING,
        }, false)

        expect(result).toEqual({
            processed: 3,
            status: ImportJobStatus.COMPLETED,
        })
    })

    it('keeps the job failed after a previous error even when the last item is consumed', () => {
        const result = resolveImportJobAfterAttempt({
            processed: 2,
            total: 3,
            status: ImportJobStatus.FAILED,
        }, false)

        expect(result).toEqual({
            processed: 3,
            status: ImportJobStatus.FAILED,
        })
    })

    it('marks the job as failed when the final outcome fails', () => {
        const result = resolveImportJobAfterAttempt({
            processed: 0,
            total: 1,
            status: ImportJobStatus.PROCESSING,
        }, true)

        expect(result).toEqual({
            processed: 1,
            status: ImportJobStatus.FAILED,
        })
    })
})
