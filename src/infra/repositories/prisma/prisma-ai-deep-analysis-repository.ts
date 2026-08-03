import type { AiDeepAnalysis, Prisma } from '@prisma/client'
import type {
    AiDeepAnalysisRepository,
    UpsertAiDeepAnalysisData,
} from '@/application/repositories/ai-deep-analysis-repository'
import { prisma } from '@/lib/prisma'

export class PrismaAiDeepAnalysisRepository implements AiDeepAnalysisRepository {
    async findByUserAndPeriod(userId: string, period: string): Promise<AiDeepAnalysis | null> {
        return prisma.aiDeepAnalysis.findUnique({
            where: { userId_period: { userId, period } },
        })
    }

    async upsert(data: UpsertAiDeepAnalysisData): Promise<AiDeepAnalysis> {
        const existing = await this.findByUserAndPeriod(data.userId, data.period)

        return prisma.aiDeepAnalysis.upsert({
            where: { userId_period: { userId: data.userId, period: data.period } },
            create: {
                userId: data.userId,
                period: data.period,
                inputHash: data.inputHash,
                sections: data.sections as Prisma.InputJsonValue,
                model: data.model,
                promptTokens: data.promptTokens,
                completionTokens: data.completionTokens,
            },
            update: {
                inputHash: data.inputHash,
                sections: data.sections as Prisma.InputJsonValue,
                model: data.model,
                promptTokens: data.promptTokens,
                completionTokens: data.completionTokens,
                generatedAt: new Date(),
                regeneratedCount: (existing?.regeneratedCount ?? 0) + (existing ? 1 : 0),
            },
        })
    }
}
