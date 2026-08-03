import { FastifyInstance } from 'fastify'
import { DeepAnalysisController } from '@/application/controllers/deep-analysis-controller'
import { GetMonthlySummaryUseCase } from '@/application/use-cases/dashboard-use-case/get-monthly-summary.use-case'
import { GetCardItemRecommendationsUseCase } from '@/application/use-cases/deep-analysis-use-case/get-card-item-recommendations.use-case'
import { GetEmergencyReserveStatusUseCase } from '@/application/use-cases/deep-analysis-use-case/get-emergency-reserve-status.use-case'
import { BuildDeepAnalysisSnapshotUseCase } from '@/application/use-cases/deep-analysis-use-case/build-deep-analysis-snapshot.use-case'
import { GetDeepAnalysisUseCase } from '@/application/use-cases/deep-analysis-use-case/get-deep-analysis.use-case'
import { GenerateDeepAnalysisUseCase } from '@/application/use-cases/deep-analysis-use-case/generate-deep-analysis.use-case'
import { GetFinancialGoalSettingsUseCase } from '@/application/use-cases/deep-analysis-use-case/get-financial-goal-settings.use-case'
import { UpdateFinancialGoalSettingsUseCase } from '@/application/use-cases/deep-analysis-use-case/update-financial-goal-settings.use-case'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'
import { PrismaAccountRepository } from '@/infra/repositories/prisma/prisma-account-repository'
import { PrismaFinancialGoalSettingsRepository } from '@/infra/repositories/prisma/prisma-financial-goal-settings-repository'
import { PrismaAiDeepAnalysisRepository } from '@/infra/repositories/prisma/prisma-ai-deep-analysis-repository'

function buildDeepAnalysisController(): DeepAnalysisController {
    const transactionRepository = new PrismaTransactionRepository()
    const categoryRepository = new PrismaCategoryRepository()
    const accountRepository = new PrismaAccountRepository()
    const financialGoalSettingsRepository = new PrismaFinancialGoalSettingsRepository()
    const aiDeepAnalysisRepository = new PrismaAiDeepAnalysisRepository()

    const monthlySummaryUseCase = new GetMonthlySummaryUseCase(transactionRepository, categoryRepository)
    const cardItemRecommendationsUseCase = new GetCardItemRecommendationsUseCase(transactionRepository)
    const emergencyReserveStatusUseCase = new GetEmergencyReserveStatusUseCase(
        accountRepository,
        financialGoalSettingsRepository,
        monthlySummaryUseCase,
    )
    const buildSnapshotUseCase = new BuildDeepAnalysisSnapshotUseCase(
        monthlySummaryUseCase,
        cardItemRecommendationsUseCase,
        emergencyReserveStatusUseCase,
    )

    const getDeepAnalysisUseCase = new GetDeepAnalysisUseCase(buildSnapshotUseCase, aiDeepAnalysisRepository)
    const generateDeepAnalysisUseCase = new GenerateDeepAnalysisUseCase(buildSnapshotUseCase, aiDeepAnalysisRepository)
    const getFinancialGoalSettingsUseCase = new GetFinancialGoalSettingsUseCase(financialGoalSettingsRepository)
    const updateFinancialGoalSettingsUseCase = new UpdateFinancialGoalSettingsUseCase(financialGoalSettingsRepository)

    return new DeepAnalysisController(
        getDeepAnalysisUseCase,
        generateDeepAnalysisUseCase,
        getFinancialGoalSettingsUseCase,
        updateFinancialGoalSettingsUseCase,
    )
}

export async function deepAnalysisRoutes(app: FastifyInstance) {
    const controller = buildDeepAnalysisController()

    app.get('/reports/deep-analysis', (req, reply) => controller.getDeepAnalysis(req, reply))
    app.post('/reports/deep-analysis/generate', (req, reply) => controller.generateDeepAnalysis(req, reply))
    app.get('/goals/emergency-reserve', (req, reply) => controller.getGoalSettings(req, reply))
    app.put('/goals/emergency-reserve', (req, reply) => controller.updateGoalSettings(req, reply))
}
