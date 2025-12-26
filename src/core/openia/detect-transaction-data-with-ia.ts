import OpenAI from 'openai'
import type {
    TransactionType,
    TransactionCategory,
    TransactionPaymentMethod
} from '@prisma/client'

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
})

const VALID_TYPES: TransactionType[] = ['EXPENSE', 'DEPOSIT', 'INVESTMENT']
const VALID_CATEGORIES: TransactionCategory[] = [
    'EDUCATION',
    'ENTERTAINMENT',
    'SERVICES',
    'FOOD',
    'HEALTH',
    'HOUSING',
    'OTHER',
    'SALARY',
    'TRANSPORTATION',
    'UTILITY',
    'FOOD_DELIVERY',
    'SIGNATURE',
    'GAMING'
]
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
    title: string,
    rawCategory?: string
): Promise<{
    type: TransactionType
    category: TransactionCategory
    paymentMethod: TransactionPaymentMethod
}> {

    const userProvidedCategoryInstruction = `A categoria informada pelo usuário foi: "${rawCategory}". 
       Ela pode não ser exatamente igual às categorias permitidas. 
       Mapeie para a mais próxima entre: ${VALID_CATEGORIES.join(', ')}.`;

    const inferCategoryFromTitleInstruction = 'Não há categoria informada. Deduzir com base apenas no título da transação.';

    const categoryInstruction = rawCategory ? userProvidedCategoryInstruction : inferCategoryFromTitleInstruction;

    const prompt = `
        Você é um sistema de classificação de transações financeiras.

        Com base nas informações abaixo, retorne:

        - O tipo da transação (TransactionType): ${VALID_TYPES.join(', ')}
        - A categoria da transação (TransactionCategory): ${VALID_CATEGORIES.join(', ')}
        - O método de pagamento (TransactionPaymentMethod): ${VALID_METHODS.join(', ')}

        Sempre responda no seguinte formato JSON:
        {
        "type": "EXPENSE",
        "category": "FOOD",
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

        const isValid =
            VALID_TYPES.includes(parsed.type) &&
            VALID_CATEGORIES.includes(parsed.category) &&
            VALID_METHODS.includes(parsed.paymentMethod)

        if (!isValid) {
            console.warn('⚠️ Classificação inválida detectada:', parsed)
            throw new Error('Resposta inválida da IA.')
        }

        console.log('✅ Classificação OK:', parsed)
        return parsed
    } catch (error) {
        console.error('❌ Erro ao classificar transação com IA:', error)

        return {
            type: 'EXPENSE',
            category: 'OTHER',
            paymentMethod: 'CREDIT_CARD'
        }
    }
}
