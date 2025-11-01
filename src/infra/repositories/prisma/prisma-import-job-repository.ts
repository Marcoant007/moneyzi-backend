import { prisma } from '@/lib/prisma'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import type { ImportJob, ImportJobStatus } from '@prisma/client'

export class PrismaImportJobRepository implements ImportJobRepository {
    async create(data: { userId: string; total: number; processed?: number }): Promise<ImportJob> {
        return prisma.importJob.create({
            data: {
                userId: data.userId,
                total: data.total,
                processed: data.processed ?? 0,
            },
        })
    }

    async incrementProcessed(id: string): Promise<ImportJob> {
        return prisma.importJob.update({
            where: { id },
            data: { processed: { increment: 1 } },
        })
    }

    async markStatus(id: string, status: ImportJobStatus): Promise<void> {
        await prisma.importJob.update({
            where: { id },
            data: { status },
        })
    }

    async findById(id: string): Promise<ImportJob | null> {
        return prisma.importJob.findUnique({ where: { id } })
    }
}
