import { GoogleGenerativeAI } from '@google/generative-ai'
import {
    TransactionType,
    TransactionCategory,
    TransactionPaymentMethod,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const VALID_TYPES: TransactionType[] = ['EXPENSE', 'DEPOSIT', 'INVESTMENT']
const VALID_CATEGORY_ENUMS = Object.values(TransactionCategory)
const VALID_METHODS: TransactionPaymentMethod[] = [
    'CREDIT_CARD',
    'DEBIT_CARD',
    'BANK_TRANSFER',
    'BANK_SLIP',
    'CASH',
    'PIX',
    'OTHER',
]
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 20000)

function fallbackClassification(): {
    type: TransactionType
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
} {
    return {
        type: 'EXPENSE',
        category: 'OTHER',
        paymentMethod: 'CREDIT_CARD',
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Gemini timeout after ${timeoutMs}ms`))
        }, timeoutMs)

        promise
            .then((value) => {
                clearTimeout(timeout)
                resolve(value)
            })
            .catch((error) => {
                clearTimeout(timeout)
                reject(error)
            })
    })
}

export async function detectTransactionDataWithIA(
    userId: string,
    title: string,
    rawCategory?: string,
): Promise<{
    type: TransactionType
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
    categoryId?: string
    categoryName?: string
}> {
    const userCategories = await prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
    })

    const userCategoryNames = userCategories.map((category) => category.name)
    const findCategoryId = (name: string) =>
        userCategories.find((category) => category.name.toLowerCase() === name.toLowerCase())?.id

    const userProvidedCategoryInstruction = `A categoria informada pelo usuário foi: "${rawCategory}". 
Ela pode não ser exatamente igual às categorias disponíveis.
Mapeie para a mais próxima entre: ${userCategoryNames.join(', ')}.`

    const inferCategoryFromTitleInstruction =
        'Não há categoria informada. Deduzir a categoria com base apenas no título da transação.'

    const categoryInstruction = rawCategory
        ? userProvidedCategoryInstruction
        : inferCategoryFromTitleInstruction

    const prompt = `
Você é um sistema de classificação de transações financeiras.

Com base nas informações abaixo, retorne:

- O tipo da transação (TransactionType): ${VALID_TYPES.join(', ')}
- A categoria específica (UserCategory): Escolha uma destas: ${userCategoryNames.join(', ')} (Se nenhuma fizer sentido, escolha a mais próxima ou invente uma nova se permitido, mas prefira as existentes).
- A categoria padrão (TransactionCategory): ${VALID_CATEGORY_ENUMS.join(', ')} (Escolha a que melhor engloba a categoria específica).
- O método de pagamento (TransactionPaymentMethod): ${VALID_METHODS.join(', ')}

Sempre responda no seguinte formato JSON:
{
  "type": "EXPENSE",
  "userCategoryName": "Mercado",
  "categoryEnum": "FOOD",
  "paymentMethod": "CREDIT_CARD"
}

Título da transação: "${title}"
${categoryInstruction}`

    try {
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        })

        const fullPrompt = `Você é um classificador inteligente de transações bancárias.

${prompt}`

        const result = await withTimeout(
            model.generateContent(fullPrompt),
            GEMINI_TIMEOUT_MS,
        )

        const response = await result.response
        const text = response.text()

        const raw = text.trim()
        const cleaned = raw.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(cleaned)
        const matchedCategoryId = parsed.userCategoryName
            ? findCategoryId(parsed.userCategoryName)
            : undefined

        const isValid =
            VALID_TYPES.includes(parsed.type) &&
            VALID_CATEGORY_ENUMS.includes(parsed.categoryEnum) &&
            VALID_METHODS.includes(parsed.paymentMethod)

        if (!isValid) {
            console.warn('Classificação inválida detectada:', parsed)
            return fallbackClassification()
        }

        console.log('Classificação OK:', parsed)

        return {
            type: parsed.type,
            category: parsed.categoryEnum,
            paymentMethod: parsed.paymentMethod,
            categoryId: matchedCategoryId,
            categoryName: parsed.userCategoryName,
        }
    } catch (error) {
        console.error('Erro ao classificar transação com IA:', error)
        return fallbackClassification()
    }
}
