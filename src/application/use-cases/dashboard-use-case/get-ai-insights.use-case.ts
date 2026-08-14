import { GoogleGenerativeAI } from '@google/generative-ai'
import { redis } from '@/infra/cache/redis'
import { format } from 'date-fns'
import type { AppLocale } from '@/core/types/locale'

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
        locale: AppLocale = 'pt',
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
        const result = await model.generateContent(this.buildPrompt(context, locale))
        const text = result.response.text()

        return { insights: this.parseInsights(text), remaining }
    }

    private buildPrompt(ctx: AiInsightContext, locale: AppLocale): string {
        if (locale === 'en') return this.buildPromptEn(ctx)
        return this.buildPromptPt(ctx)
    }

    private buildPromptPt(ctx: AiInsightContext): string {
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

    private buildPromptEn(ctx: AiInsightContext): string {
        const topOffenders = ctx.topOffenders
            .slice(0, 3)
            .map((o) => `${o.category} R$${o.total.toFixed(2)} (${o.incomePercent.toFixed(1)}% of income)`)
            .join(' | ')

        const creditInfo = ctx.creditCardAnalysis.total > 0
            ? `Card: R$${ctx.creditCardAnalysis.total.toFixed(2)} (${ctx.creditCardAnalysis.expensePercent.toFixed(1)}% of expenses)${ctx.creditCardAnalysis.isDominant ? ' — dominant' : ''}${ctx.creditCardAnalysis.topCategory ? ` | Top: ${ctx.creditCardAnalysis.topCategory.name} R$${ctx.creditCardAnalysis.topCategory.total.toFixed(2)}` : ''}`
            : 'No credit card usage.'

        return `You are a Brazilian personal finance assistant. Analyze the monthly financial summary below and generate exactly 4 short insights (max 2 lines each), direct and actionable, written in English.

Rules:
- Mention real categories and amounts when relevant
- Point out real problems and one concrete action for each
- Vary the themes: variable spending, credit card, reserve/future, income commitment
- Don't use generic phrases like "keep monitoring"
- Tone: consultative, no drama
- All monetary values are in Brazilian Reais (R$) — keep them in R$ exactly as given below, do not convert to another currency

MONTH SUMMARY:
Income: R$${ctx.income.toFixed(2)} | Expenses: R$${ctx.expenses.toFixed(2)} | Balance: R$${ctx.balance.toFixed(2)}
Commitment: ${ctx.commitmentRate.toFixed(1)}%
Fixed: R$${ctx.fixedExpenses.total.toFixed(2)} (${ctx.fixedExpenses.incomePercent.toFixed(1)}%)${ctx.variableExpenses.topCategory ? ` | Top fixed: ${ctx.variableExpenses.topCategory.category}` : ''}
Variable: R$${ctx.variableExpenses.total.toFixed(2)} (${ctx.variableExpenses.incomePercent.toFixed(1)}%)${ctx.variableExpenses.topCategory ? ` | Top variable: ${ctx.variableExpenses.topCategory.category} R$${ctx.variableExpenses.topCategory.total.toFixed(2)}` : ''}
${creditInfo}
Top expenses: ${topOffenders || 'none'}
50/30/20 — Essentials: ${ctx.rule503020.needs.actualPercent.toFixed(1)}% | Lifestyle: ${ctx.rule503020.wants.actualPercent.toFixed(1)}% | Future: ${ctx.rule503020.future.actualPercent.toFixed(1)}% (R$${ctx.rule503020.future.total.toFixed(2)})

Respond with ONLY the 4 insights, one per line, no numbering, no bullets, no greeting.`
    }

    private parseInsights(text: string): string[] {
        return text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 15)
            .slice(0, 4)
    }
}
