import { prisma } from '@/lib/prisma'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import type { ImportJob, ImportJobStatus } from '@prisma/client'
import { resolveImportJobAfterAttempt } from '@/application/use-cases/import-use-case/resolve-import-job-after-attempt'

export class PrismaImportJobRepository implements ImportJobRepository {
    async create(data: {
        userId: string
        total: number
        processed?: number
        creditCardId?: string
        isCreditCardInvoice?: boolean
    }): Promise<ImportJob> {
        return prisma.importJob.create({
            data: {
                userId: data.userId,
                total: data.total,
                processed: data.processed ?? 0,
                creditCardId: data.creditCardId ?? null,
                isCreditCardInvoice: data.isCreditCardInvoice ?? false,
            },
        })
    }

    async registerAttempt(id: string, didFail: boolean): Promise<ImportJob | null> {
        return prisma.$transaction(async (tx) => {
            const job = await tx.importJob.findUnique({
                where: { id },
            })

            if (!job) {
                return null
            }

            const next = resolveImportJobAfterAttempt(job, didFail)

            return tx.importJob.update({
                where: { id },
                data: {
                    processed: next.processed,
                    status: next.status,
                },
            })
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
