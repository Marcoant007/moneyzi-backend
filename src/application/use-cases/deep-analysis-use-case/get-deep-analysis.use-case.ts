import type { AiDeepAnalysisRepository } from '@/application/repositories/ai-deep-analysis-repository'
import type { BuildDeepAnalysisSnapshotUseCase } from './build-deep-analysis-snapshot.use-case'
import { buildInputHash, type DeepAnalysisInput, type DeepAnalysisOutput, type DeepAnalysisRecord } from './deep-analysis.types'
import type { EmergencyReserveStatus } from './get-emergency-reserve-status.use-case'

export type GetDeepAnalysisOutput = {
    creditCardAnalysis: DeepAnalysisInput['creditCardAnalysis']
    emergencyReserve: EmergencyReserveStatus
    analysis: DeepAnalysisRecord | null
}

export class GetDeepAnalysisUseCase {
    constructor(
        private readonly buildSnapshotUseCase: BuildDeepAnalysisSnapshotUseCase,
        private readonly aiDeepAnalysisRepository: AiDeepAnalysisRepository,
    ) { }

    async execute(userId: string, period: string): Promise<GetDeepAnalysisOutput> {
        const snapshot = await this.buildSnapshotUseCase.execute(userId, period)
        const stored = await this.aiDeepAnalysisRepository.findByUserAndPeriod(userId, period)

        if (!stored) {
            return {
                creditCardAnalysis: snapshot.creditCardAnalysis,
                emergencyReserve: snapshot.emergencyReserve,
                analysis: null,
            }
        }

        const inputHash = buildInputHash(snapshot)
        const sections = stored.sections as unknown as DeepAnalysisOutput

        return {
            creditCardAnalysis: snapshot.creditCardAnalysis,
            emergencyReserve: snapshot.emergencyReserve,
            analysis: {
                ...sections,
                stale: stored.inputHash !== inputHash,
                generatedAt: stored.generatedAt.toISOString(),
                model: stored.model,
                regeneratedCount: stored.regeneratedCount,
            },
        }
    }
}
