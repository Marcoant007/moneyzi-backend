import { GoogleGenerativeAI } from '@google/generative-ai'
import { TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const VALID_TYPES: TransactionType[] = ['EXPENSE', 'DEPOSIT', 'INVESTMENT']
const VALID_CATEGORY_ENUMS = Object.values(TransactionCategory)
const VALID_METHODS: TransactionPaymentMethod[] = [
    'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'BANK_SLIP', 'CASH', 'PIX', 'OTHER',
]

const BATCH_SIZE = 50
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000)
const DEFAULT_RETRY_DELAY_MS = 65_000

export interface BatchTransactionInput {
    name: string
    rawCategory?: string
}

export interface BatchTransactionResult {
    type: TransactionType
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
    categoryId?: string
    categoryName?: string
}

function fallback(): BatchTransactionResult {
    return { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD' }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms)
        promise.then((v) => { clearTimeout(t); resolve(v) }).catch((e) => { clearTimeout(t); reject(e) })
    })
}

async function classifyBatch(
    items: BatchTransactionInput[],
    userCategoryNames: string[],
): Promise<BatchTransactionResult[]> {
    const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    })

    const lines = items.map((item, i) => {
        const hint = item.rawCategory ? ` (categoria: "${item.rawCategory}")` : ''
        return `${i + 1}. "${item.name}"${hint}`
    })

    const prompt = `Você é um classificador de transações financeiras brasileiras.

Classifique CADA transação abaixo e retorne um array JSON com exatamente ${items.length} objetos na mesma ordem.

Categorias do usuário disponíveis: ${userCategoryNames.length > 0 ? userCategoryNames.join(', ') : '(nenhuma)'}
Tipos válidos (type): ${VALID_TYPES.join(', ')}
Categorias padrão válidas (categoryEnum): ${VALID_CATEGORY_ENUMS.join(', ')}
Métodos válidos (paymentMethod): ${VALID_METHODS.join(', ')}

Formato de resposta — retorne SOMENTE o array JSON, sem texto adicional:
[
  {"type": "EXPENSE", "categoryEnum": "FOOD", "paymentMethod": "CREDIT_CARD", "userCategoryName": "Alimentação"},
  ...
]

Transações:
${lines.join('\n')}`

    const MAX_RETRIES = 3
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await withTimeout(model.generateContent(prompt), GEMINI_TIMEOUT_MS)
            const text = result.response.text().trim().replace(/```json|```/g, '').trim()
            const parsed: any[] = JSON.parse(text)

            if (!Array.isArray(parsed) || parsed.length !== items.length) {
                console.warn(`Batch response length mismatch: expected ${items.length}, got ${parsed.length}`)
                return items.map(() => fallback())
            }

            return parsed.map((p) => {
                const isValid =
                    VALID_TYPES.includes(p.type) &&
                    VALID_CATEGORY_ENUMS.includes(p.categoryEnum) &&
                    VALID_METHODS.includes(p.paymentMethod)

                if (!isValid) return fallback()

                return {
                    type: p.type as TransactionType,
                    category: p.categoryEnum as TransactionCategory,
                    paymentMethod: p.paymentMethod as TransactionPaymentMethod,
                    categoryName: p.userCategoryName ?? undefined,
                }
            })
        } catch (error: any) {
            const is429 = error?.status === 429 || error?.statusText === 'Too Many Requests'

            if (is429 && attempt < MAX_RETRIES) {
                let delayMs = DEFAULT_RETRY_DELAY_MS
                try {
                    const retryInfo = error?.errorDetails?.find(
                        (d: any) => d['@type']?.includes('RetryInfo')
                    )
                    if (retryInfo?.retryDelay) {
                        const seconds = parseInt(String(retryInfo.retryDelay).replace('s', ''), 10)
                        if (!isNaN(seconds)) delayMs = (seconds + 5) * 1000
                    }
                } catch {}

                console.warn(`Gemini batch rate limit (429), tentativa ${attempt + 1}/${MAX_RETRIES}. Aguardando ${delayMs / 1000}s...`)
                await new Promise((r) => setTimeout(r, delayMs))
                continue
            }

            console.error('Erro na classificação em batch:', error)
            return items.map(() => fallback())
        }
    }

    return items.map(() => fallback())
}

export async function detectTransactionsBatchWithIA(
    userId: string,
    transactions: BatchTransactionInput[],
): Promise<BatchTransactionResult[]> {
    if (transactions.length === 0) return []

    const userCategories = await prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
    })

    const userCategoryNames = userCategories.map((c) => c.name)
    const findCategoryId = (name?: string) =>
        name ? userCategories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id : undefined

    const results: BatchTransactionResult[] = []

    // Processa em lotes de BATCH_SIZE para não estourar o contexto do modelo
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
        const batch = transactions.slice(i, i + BATCH_SIZE)
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(transactions.length / BATCH_SIZE)
        console.log(`Classificando batch ${batchNumber}/${totalBatches} (${batch.length} transações)`)

        const batchResults = await classifyBatch(batch, userCategoryNames)

        // Resolve categoryId para cada resultado
        for (const result of batchResults) {
            result.categoryId = findCategoryId(result.categoryName)
            results.push(result)
        }
    }

    return results
}
