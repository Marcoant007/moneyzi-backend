import { FastifyInstance } from 'fastify'
import { ReportController } from '@/application/controllers/report-controller'
import { GetDashboardReportUseCase } from '@/application/use-cases/dashboard-use-case/get-dashboard-report.use-case'
import { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'

function buildReportController(): ReportController {
    const transactionRepository = new PrismaTransactionRepository()
    const categoryRepository = new PrismaCategoryRepository()

    const dashboardUseCase = new GetDashboardReportUseCase(transactionRepository, categoryRepository)
    const monthlySummaryUseCase = new GetMonthlySummaryUseCase(transactionRepository, categoryRepository)

    return new ReportController(dashboardUseCase, monthlySummaryUseCase)
}

export async function reportRoutes(app: FastifyInstance) {
    const controller = buildReportController()

    app.get('/reports/dashboard', (req, reply) => controller.getDashboard(req, reply))
    app.get('/reports/monthly-summary', (req, reply) => controller.getMonthlySummary(req, reply))
}
