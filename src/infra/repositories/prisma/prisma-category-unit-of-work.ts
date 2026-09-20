import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { CategoryUnitOfWork, CategoryUnitOfWorkContext } from '@/application/repositories/category-unit-of-work'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'
import { PrismaMcpAuditLogRepository } from '@/infra/repositories/prisma/prisma-mcp-audit-log-repository'

// Uma categoria com muitas transações faz o updateMany do merge demorar mais
// que os 5s padrão do Prisma, principalmente com cold start do Neon.
const TRANSACTION_OPTIONS = {
    // Serializable: duas reorganizações concorrentes sobre as mesmas categorias
    // não conseguem as duas validar-e-gravar em cima de um estado que a outra
    // acabou de mudar — uma delas falha com P2034 (mapeado abaixo) e é só repetir.
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 20000,
} as const

export class PrismaCategoryUnitOfWork implements CategoryUnitOfWork {
    async run<T>(work: (context: CategoryUnitOfWorkContext) => Promise<T>): Promise<T> {
        try {
            return await prisma.$transaction(
                (tx) =>
                    work({
                        categoryRepository: new PrismaCategoryRepository(tx),
                        mcpAuditLogRepository: new PrismaMcpAuditLogRepository(tx),
                    }),
                TRANSACTION_OPTIONS,
            )
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                throw new Error(
                    'CONCURRENT_MODIFICATION: as categorias mudaram durante a operação (outra alteração aconteceu ao mesmo tempo). Nada foi alterado — rode de novo.',
                )
            }
            throw error
        }
    }
}
