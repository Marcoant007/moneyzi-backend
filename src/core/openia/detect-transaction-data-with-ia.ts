import OpenAI from 'openai'
import {
    TransactionType,
    TransactionCategory,
    TransactionPaymentMethod
} from '@prisma/client'
import { prisma } from '@/lib/prisma'

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
})

const VALID_TYPES: TransactionType[] = ['EXPENSE', 'DEPOSIT', 'INVESTMENT']

const VALID_CATEGORY_ENUMS = Object.values(TransactionCategory)

const VALID_METHODS: TransactionPaymentMethod[] = [
    'CREDIT_CARD',
    'DEBIT_CARD',
    'BANK_TRANSFER',
    'BANK_SLIP',
    'CASH',
    'PIX',
    'OTHER'
]


export async function detectTransactionDataWithIA(
    userId: string,
    title: string,
    rawCategory?: string
): Promise<{
    type: TransactionType
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
    categoryId?: string
    categoryName?: string
}> {

    const userCategories = await prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true }
    })

    const userCategoryNames = userCategories.map(c => c.name)

    // Helper to find ID by name
    const findCategoryId = (name: string) => userCategories.find(c => c.name.toLowerCase() === name.toLowerCase())?.id

    const userProvidedCategoryInstruction = `A categoria informada pelo usuário foi: "${rawCategory}". 
       Ela pode não ser exatamente igual às categorias disponíveis. 
       Mapeie para a mais próxima entre: ${userCategoryNames.join(', ')}.`;

    const inferCategoryFromTitleInstruction = 'Não há categoria informada. Deduzir a categoria com base apenas no título da transação.';

    const categoryInstruction = rawCategory ? userProvidedCategoryInstruction : inferCategoryFromTitleInstruction;

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
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'Você é um classificador inteligente de transações bancárias.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ]
        })

        const raw = completion.choices[0].message.content?.trim() ?? ''
        const cleaned = raw.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(cleaned)

        // Find the ID for the chosen user category
        const matchedCategoryId = parsed.userCategoryName ? findCategoryId(parsed.userCategoryName) : undefined

        // If returned userCategoryName is not in list (AI hallucinated or suggested new), we rely on enum or valid logic. 
        // But the prompt asked to pick from list.

        const isValid =
            VALID_TYPES.includes(parsed.type) &&
            VALID_CATEGORY_ENUMS.includes(parsed.categoryEnum) &&
            VALID_METHODS.includes(parsed.paymentMethod)

        if (!isValid) {
            console.warn('⚠️ Classificação inválida detectada:', parsed)
            // Fallback
            return {
                type: 'EXPENSE',
                category: 'OTHER',
                paymentMethod: 'CREDIT_CARD'
            }
        }

        console.log('✅ Classificação OK:', parsed)

        return {
            type: parsed.type,
            category: parsed.categoryEnum, // Map to the Enum field
            paymentMethod: parsed.paymentMethod,
            categoryId: matchedCategoryId,
            categoryName: parsed.userCategoryName
        }

    } catch (error) {
        console.error('❌ Erro ao classificar transação com IA:', error)

        return {
            type: 'EXPENSE',
            category: 'OTHER',
            paymentMethod: 'CREDIT_CARD'
        }
    }
}
