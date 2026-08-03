import type { AiDeepAnalysis } from '@prisma/client'

export interface UpsertAiDeepAnalysisData {
    userId: string
    period: string
    inputHash: string
    sections: Record<string, unknown>
    model: string
    promptTokens?: number
    completionTokens?: number
}

export interface AiDeepAnalysisRepository {
    findByUserAndPeriod(userId: string, period: string): Promise<AiDeepAnalysis | null>
    upsert(data: UpsertAiDeepAnalysisData): Promise<AiDeepAnalysis>
}
