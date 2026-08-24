import { FastifyInstance } from 'fastify'
import { ReportController } from '@/application/controllers/report-controller'
import { GetDashboardReportUseCase } from '@/application/use-cases/dashboard-use-case/get-dashboard-report.use-case'
import { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { GetAiInsightsUseCase } from '@/application/use-cases/dashboard-use-case/get-ai-insights.use-case'
import { GetCategoryMonthMatrixUseCase } from '@/application/use-cases/dashboard-use-case/get-category-month-matrix.use-case'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'

function buildReportController(): ReportController {
    const transactionRepository = new PrismaTransactionRepository()
    const categoryRepository = new PrismaCategoryRepository()

    const dashboardUseCase = new GetDashboardReportUseCase(transactionRepository, categoryRepository)
    const monthlySummaryUseCase = new GetMonthlySummaryUseCase(transactionRepository, categoryRepository)
    const aiInsightsUseCase = new GetAiInsightsUseCase()
    const categoryMonthMatrixUseCase = new GetCategoryMonthMatrixUseCase(transactionRepository, categoryRepository)

    return new ReportController(dashboardUseCase, monthlySummaryUseCase, aiInsightsUseCase, categoryMonthMatrixUseCase)
}

export async function reportRoutes(app: FastifyInstance) {
    const controller = buildReportController()

    app.get('/reports/dashboard', (req, reply) => controller.getDashboard(req, reply))
    app.get('/reports/monthly-summary', (req, reply) => controller.getMonthlySummary(req, reply))
    app.post('/reports/ai-insights', (req, reply) => controller.getAiInsights(req, reply))
    app.get('/reports/category-month-matrix', (req, reply) => controller.getCategoryMonthMatrix(req, reply))
}
