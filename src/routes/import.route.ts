import { FastifyInstance } from 'fastify'
import { ImportController } from '@/application/controllers/import-controller'
import { PrismaUserRepository } from '@/infra/repositories/prisma/prisma-user-repository'
import { PrismaImportJobRepository } from '@/infra/repositories/prisma/prisma-import-job-repository'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { StartImportUseCase } from '@/application/use-cases/start-import.use-case'
import { GetImportJobStatusUseCase } from '@/application/use-cases/get-import-job-status.use-case'
import { GetDashboardUseCase } from '@/application/use-cases/get-dashboard.use-case'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'

export async function importRoutes(app: FastifyInstance) {
    app.get('/health', async (request, reply) => {
        return reply.send({ ok: true })
    })

    app.get('/test', async (request, reply) => {
        const userId = request.headers['x-user-id'] as string | undefined
        return reply.send({ ok: true, userId: userId ?? null })
    })

    app.post('/import-csv', (request, reply) => importController.importCsv(request, reply))

    app.get('/dashboard', (request, reply) => importController.getDashboard(request, reply))

    app.get('/import/:id', (request, reply) => importController.getImportJobStatus(request, reply))
}

const importController = buildImportController()
function buildImportController(): ImportController {
    const userRepository = new PrismaUserRepository()
    const importJobRepository = new PrismaImportJobRepository()
    const transactionRepository = new PrismaTransactionRepository()
    const categoryRepository = new PrismaCategoryRepository()

    const startImportUseCase = new StartImportUseCase(userRepository, importJobRepository)
    const getImportJobStatusUseCase = new GetImportJobStatusUseCase(importJobRepository)
    const getDashboardUseCase = new GetDashboardUseCase(transactionRepository, categoryRepository)

    return new ImportController(startImportUseCase, getImportJobStatusUseCase, getDashboardUseCase)
}
