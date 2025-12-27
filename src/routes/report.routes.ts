import { FastifyInstance } from 'fastify'
import { ReportController } from '@/application/controllers/report-controller'
import { GetDashboardReportUseCase } from '@/application/use-cases/get-dashboard-report.use-case'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'

function buildReportController(): ReportController {
    const transactionRepository = new PrismaTransactionRepository()
    const categoryRepository = new PrismaCategoryRepository()

    const useCase = new GetDashboardReportUseCase(transactionRepository, categoryRepository)

    return new ReportController(useCase)
}

export async function reportRoutes(app: FastifyInstance) {
    const controller = buildReportController()

    app.get('/reports/dashboard', (req, reply) => controller.getDashboard(req, reply))
}
