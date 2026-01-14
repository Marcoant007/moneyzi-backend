import type { ImportJobDto } from '@/core/dtos/import-job.dto'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'

export class GetImportJobStatusUseCase {
    constructor(private readonly importJobRepository: ImportJobRepository) { }

    async execute(input: { id: string }): Promise<{ job: ImportJobDto | null }> {
        const job = await this.importJobRepository.findById(input.id)
        if (!job) return { job: null }

        return {
            job: {
                id: job.id,
                userId: job.userId,
                status: job.status,
                total: job.total,
                processed: job.processed,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            },
        }
    }
}
