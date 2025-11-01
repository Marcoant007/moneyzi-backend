import { ImportService } from '@/service/import-service'
import { ImportJobDto } from '@/core/dtos/import-job.dto'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import type { UserRepository } from '@/application/repositories/user-repository'

export class StartImportUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly importJobRepository: ImportJobRepository,
    ) { }

    async execute(input: { userId: string; fileBuffer: Buffer }): Promise<{ job: ImportJobDto }> {
        const userId = input.userId.trim()
        if (!userId) {
            throw new Error('Usuário inválido')
        }

        const user = await this.userRepository.findById(userId)
        if (!user) {
            throw new Error('Usuário não encontrado')
        }

        const parsed = ImportService.parseOnly(input.fileBuffer)

        const job = await this.importJobRepository.create({
            userId,
            total: parsed.length,
            processed: 0,
        })

        await ImportService.import(input.fileBuffer, userId, job.id)

        const dto: ImportJobDto = {
            id: job.id,
            userId: job.userId,
            status: job.status,
            total: job.total,
            processed: job.processed,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        }

        return { job: dto }
    }
}
