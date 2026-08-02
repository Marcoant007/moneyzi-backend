import { GoogleGenerativeAI } from '@google/generative-ai'
import { format } from 'date-fns'
import { z } from 'zod'
import { redis } from '@/infra/cache/redis'
import type { AiDeepAnalysisRepository } from '@/application/repositories/ai-deep-analysis-repository'
import type { BuildDeepAnalysisSnapshotUseCase } from './build-deep-analysis-snapshot.use-case'
import { buildInputHash, type DeepAnalysisInput, type DeepAnalysisOutput, type DeepAnalysisRecord } from './deep-analysis.types'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const DAILY_LIMIT_PRO = 5
const DAILY_LIMIT_FREE = 2

const bucketStatusSchema = z.enum(['good', 'warning', 'bad'])

const outputSchema = z.object({
    summary: z.string().min(1),
    fixedHealth: z.object({ status: bucketStatusSchema, message: z.string().min(1) }),
    cardAnalysis: z.object({ status: bucketStatusSchema, message: z.string().min(1) }),
    topOffenderAdvice: z.string().min(1),
    rule503020Message: z.string().min(1),
    reserveMessage: z.string().min(1),
    actionPlan: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
})

export class GenerateDeepAnalysisUseCase {
    constructor(
        private readonly buildSnapshotUseCase: BuildDeepAnalysisSnapshotUseCase,
        private readonly aiDeepAnalysisRepository: AiDeepAnalysisRepository,
    ) { }

    async execute(userId: string, period: string, isPro: boolean): Promise<DeepAnalysisRecord> {
        const limit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_FREE
        const todayKey = `ai:deep-analysis:${userId}:${format(new Date(), 'yyyy-MM-dd')}`

        let current: number
        try {
            current = await redis.incr(todayKey)
            if (current === 1) {
                const now = new Date()
                const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
                const ttl = Math.floor((midnight.getTime() - now.getTime()) / 1000)
                await redis.expire(todayKey, ttl)
            }
        } catch {
            // Redis indisponível: permite a requisição sem rate limiting
            current = 1
        }

        if (current > limit) {
            throw new Error(`RATE_LIMIT:${limit}`)
        }

        const snapshot = await this.buildSnapshotUseCase.execute(userId, period)
        const inputHash = buildInputHash(snapshot)
        const modelName = process.env.GEMINI_MODEL_ANALYSIS || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'

        const model = genAI.getGenerativeModel({ model: modelName })
        const result = await model.generateContent(this.buildPrompt(snapshot))
        const text = result.response.text()
        const cleaned = text.trim().replace(/```json|```/g, '').trim()

        let parsed: unknown
        try {
            parsed = JSON.parse(cleaned)
        } catch {
            throw new Error('Falha ao interpretar a resposta da IA. Tente novamente.')
        }

        const validation = outputSchema.safeParse(parsed)
        if (!validation.success) {
            throw new Error('Resposta da IA fora do formato esperado. Tente novamente.')
        }

        const sections: DeepAnalysisOutput = validation.data

        const saved = await this.aiDeepAnalysisRepository.upsert({
            userId,
            period,
            inputHash,
            sections: sections as unknown as Record<string, unknown>,
            model: modelName,
        })

        return {
            ...sections,
            stale: false,
            generatedAt: saved.generatedAt.toISOString(),
            model: saved.model,
            regeneratedCount: saved.regeneratedCount,
        }
    }

    private buildPrompt(input: DeepAnalysisInput): string {
        const reserve = input.emergencyReserve
        const reserveInfo = reserve.isComplete
            ? `Reserva completa: R$${reserve.current.toFixed(2)} (meta R$${reserve.target.toFixed(2)})`
            : `Reserva: R$${reserve.current.toFixed(2)} de R$${reserve.target.toFixed(2)} (${reserve.progressPercent.toFixed(1)}%) | Faltam R$${reserve.missing.toFixed(2)} | Plano: R$${reserve.plannedMonthly.toFixed(2)}/mês${reserve.monthsAtPlannedPace ? ` (${reserve.monthsAtPlannedPace} meses)` : ''}${reserve.monthsAtCurrentPace ? ` | Ritmo real: ${reserve.monthsAtCurrentPace} meses` : ' | Ritmo real: sem sobra no momento'}`

        const topOffenders = input.topOffenders
            .slice(0, 3)
            .map((o) => `${o.category} R$${o.total.toFixed(2)} (${o.incomePercent.toFixed(1)}% renda)`)
            .join(' | ')

        return `Você é um assistente financeiro pessoal brasileiro. Analise o resumo financeiro abaixo e responda APENAS com um JSON válido (sem markdown, sem texto fora do JSON) no formato exato:

{
  "summary": "1 frase-manchete do mês",
  "fixedHealth": { "status": "good|warning|bad", "message": "até 2 linhas sobre o gasto fixo" },
  "cardAnalysis": { "status": "good|warning|bad", "message": "até 2 linhas sobre o cartão vs teto recomendado" },
  "topOffenderAdvice": "até 2 linhas com sugestão concreta sobre o maior ofensor",
  "rule503020Message": "até 2 linhas interpretando o 50/30/20",
  "reserveMessage": "até 2 linhas sobre a reserva de emergência",
  "actionPlan": ["ação 1", "ação 2", "ação 3"]
}

Regras:
- Não invente números: use somente os valores abaixo.
- Tom consultivo, direto, sem drama, em português.
- actionPlan deve ter exatamente 3 ações concretas e priorizadas.

DADOS DO MÊS (${input.period}):
Receita: R$${input.income.toFixed(2)} | Despesas: R$${input.expenses.toFixed(2)} | Saldo: R$${input.balance.toFixed(2)} | Comprometimento: ${input.commitmentRate.toFixed(1)}%
Fixas: R$${input.fixedExpenses.total.toFixed(2)} (${input.fixedExpenses.incomePercent.toFixed(1)}% renda)
Variáveis: R$${input.variableExpenses.total.toFixed(2)} (${input.variableExpenses.incomePercent.toFixed(1)}% renda)${input.variableExpenses.topCategory ? ` | Maior: ${input.variableExpenses.topCategory.category} R$${input.variableExpenses.topCategory.total.toFixed(2)}` : ''}
Cartão: R$${input.creditCardAnalysis.total.toFixed(2)} (${input.creditCardAnalysis.expensePercent.toFixed(1)}% despesas) | Teto recomendado: R$${input.creditCardAnalysis.recommendedCeiling.toFixed(2)}${input.creditCardAnalysis.isOverCeiling ? ' — ACIMA DO TETO' : ' — dentro do teto'}
Top gastos variáveis: ${topOffenders || 'nenhum'}
50/30/20 — Essenciais: ${input.rule503020.needs.actualPercent.toFixed(1)}% (ideal 50%) | Estilo de vida: ${input.rule503020.wants.actualPercent.toFixed(1)}% (ideal 30%) | Futuro: ${input.rule503020.future.actualPercent.toFixed(1)}% (ideal 20%)
${reserveInfo}
Score de saúde financeira: ${input.healthScore.value}/100 (${input.healthScore.status})`
    }
}
