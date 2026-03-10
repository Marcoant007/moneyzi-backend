import { GoogleGenerativeAI } from '@google/generative-ai'
import { redis } from '@/infra/cache/redis'
import { format } from 'date-fns'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const DAILY_LIMIT_PRO = 5
const DAILY_LIMIT_FREE = 2

export interface AiInsightContext {
    income: number
    expenses: number
    balance: number
    commitmentRate: number
    fixedExpenses: {
        total: number
        incomePercent: number
    }
    variableExpenses: {
        total: number
        incomePercent: number
        topCategory: { category: string; total: number } | null
    }
    creditCardAnalysis: {
        total: number
        expensePercent: number
        isDominant: boolean
        topCategory: { name: string; total: number } | null
    }
    topOffenders: Array<{ category: string; total: number; incomePercent: number }>
    rule503020: {
        needs: { actualPercent: number }
        wants: { actualPercent: number }
        future: { actualPercent: number; total: number }
    }
}

export class GetAiInsightsUseCase {
    async execute(
        userId: string,
        isPro: boolean,
        context: AiInsightContext,
    ): Promise<{ insights: string[]; remaining: number }> {
        const limit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_FREE
        const todayKey = `ai:insights:${userId}:${format(new Date(), 'yyyy-MM-dd')}`

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

        const remaining = Math.max(0, limit - current)

        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' })
        const result = await model.generateContent(this.buildPrompt(context))
        const text = result.response.text()

        return { insights: this.parseInsights(text), remaining }
    }

    private buildPrompt(ctx: AiInsightContext): string {
        const topOffenders = ctx.topOffenders
            .slice(0, 3)
            .map((o) => `${o.category} R$${o.total.toFixed(2)} (${o.incomePercent.toFixed(1)}% renda)`)
            .join(' | ')

        const creditInfo = ctx.creditCardAnalysis.total > 0
            ? `Cartão: R$${ctx.creditCardAnalysis.total.toFixed(2)} (${ctx.creditCardAnalysis.expensePercent.toFixed(1)}% despesas)${ctx.creditCardAnalysis.isDominant ? ' — dominante' : ''}${ctx.creditCardAnalysis.topCategory ? ` | Maior: ${ctx.creditCardAnalysis.topCategory.name} R$${ctx.creditCardAnalysis.topCategory.total.toFixed(2)}` : ''}`
            : 'Sem uso de cartão de crédito.'

        return `Você é um assistente financeiro pessoal brasileiro. Analise o resumo financeiro mensal abaixo e gere exatamente 4 insights curtos (máximo 2 linhas cada), diretos e acionáveis em português.

Regras:
- Mencione categorias e valores reais quando relevante
- Aponte problemas reais e uma ação concreta para cada um
- Varie os temas: gastos variáveis, cartão, reserva/futuro, comprometimento de renda
- Não use frases genéricas como "continue monitorando"
- Tom: consultivo, sem drama

RESUMO DO MÊS:
Receita: R$${ctx.income.toFixed(2)} | Despesas: R$${ctx.expenses.toFixed(2)} | Saldo: R$${ctx.balance.toFixed(2)}
Comprometimento: ${ctx.commitmentRate.toFixed(1)}%
Fixas: R$${ctx.fixedExpenses.total.toFixed(2)} (${ctx.fixedExpenses.incomePercent.toFixed(1)}%)${ctx.variableExpenses.topCategory ? ` | Maior fixa: ${ctx.variableExpenses.topCategory.category}` : ''}
Variáveis: R$${ctx.variableExpenses.total.toFixed(2)} (${ctx.variableExpenses.incomePercent.toFixed(1)}%)${ctx.variableExpenses.topCategory ? ` | Maior variável: ${ctx.variableExpenses.topCategory.category} R$${ctx.variableExpenses.topCategory.total.toFixed(2)}` : ''}
${creditInfo}
Top gastos: ${topOffenders || 'nenhum'}
50/30/20 — Essenciais: ${ctx.rule503020.needs.actualPercent.toFixed(1)}% | Estilo de vida: ${ctx.rule503020.wants.actualPercent.toFixed(1)}% | Futuro: ${ctx.rule503020.future.actualPercent.toFixed(1)}% (R$${ctx.rule503020.future.total.toFixed(2)})

Responda APENAS com os 4 insights, um por linha, sem numeração, sem bullets, sem saudação.`
    }

    private parseInsights(text: string): string[] {
        return text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 15)
            .slice(0, 4)
    }
}
