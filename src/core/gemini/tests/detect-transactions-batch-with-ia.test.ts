import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(function (this: unknown) {
        return {
            getGenerativeModel: () => ({
                generateContent: generateContentMock,
            }),
        }
    }),
}))

const findManyMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
    prisma: {
        category: {
            findMany: (...args: unknown[]) => findManyMock(...args),
        },
    },
}))

function jsonResponse(body: unknown) {
    return { response: { text: () => JSON.stringify(body) } }
}

function countTransactionLines(prompt: string): number {
    const matches = prompt.match(/^\d+\. "/gm)
    return matches ? matches.length : 0
}

describe('detectTransactionsBatchWithIA', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        findManyMock.mockResolvedValue([{ id: 'cat-food-1', name: 'Alimentação' }])
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('classifies every item normally on the happy path', async () => {
        const { detectTransactionsBatchWithIA } = await import('../detect-transactions-batch-with-ia')

        generateContentMock.mockImplementation(async (prompt: string) => {
            const count = countTransactionLines(prompt)
            return jsonResponse(
                Array.from({ length: count }, () => ({
                    type: 'EXPENSE',
                    categoryEnum: 'FOOD',
                    paymentMethod: 'CREDIT_CARD',
                    userCategoryName: 'Alimentação',
                })),
            )
        })

        const results = await detectTransactionsBatchWithIA('user-1', [
            { name: 'Padaria' },
            { name: 'Mercado' },
        ])

        expect(results).toHaveLength(2)
        expect(results.every((r) => r.category === 'FOOD' && r.categoryId === 'cat-food-1')).toBe(true)
        expect(generateContentMock).toHaveBeenCalledTimes(1)
    })

    it('isolates a single problematic transaction instead of collapsing the whole batch to OTHER', async () => {
        const { detectTransactionsBatchWithIA } = await import('../detect-transactions-batch-with-ia')

        // Qualquer sub-lote que ainda contenha o item "POISON" falha (simulando uma
        // resposta malformada do Gemini para aquele item específico); os demais
        // itens, isolados em sub-lotes sem o POISON, classificam normalmente.
        generateContentMock.mockImplementation(async (prompt: string) => {
            if (prompt.includes('POISON_ITEM')) {
                throw new Error('Simulated malformed response')
            }

            const count = countTransactionLines(prompt)
            return jsonResponse(
                Array.from({ length: count }, () => ({
                    type: 'EXPENSE',
                    categoryEnum: 'FOOD',
                    paymentMethod: 'CREDIT_CARD',
                    userCategoryName: 'Alimentação',
                })),
            )
        })

        const results = await detectTransactionsBatchWithIA('user-1', [
            { name: 'Padaria Boa' },
            { name: 'Mercado Legal' },
            { name: 'POISON_ITEM Corrida Estranha' },
            { name: 'Farmácia Saudável' },
        ])

        expect(results).toHaveLength(4)

        // As 3 transações "saudáveis" mantêm a classificação correta...
        expect(results[0]).toMatchObject({ category: 'FOOD', categoryId: 'cat-food-1' })
        expect(results[1]).toMatchObject({ category: 'FOOD', categoryId: 'cat-food-1' })
        expect(results[3]).toMatchObject({ category: 'FOOD', categoryId: 'cat-food-1' })

        // ...e só a transação problemática cai em fallback, isolada.
        expect(results[2]).toMatchObject({ type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD' })
        expect(results[2].categoryId).toBeUndefined()
    })

    it('falls back the whole batch on persistent 429 without splitting further (splitting would not help a quota error)', async () => {
        const { detectTransactionsBatchWithIA } = await import('../detect-transactions-batch-with-ia')

        generateContentMock.mockRejectedValue({ status: 429, statusText: 'Too Many Requests' })

        vi.useFakeTimers()

        const promise = detectTransactionsBatchWithIA('user-1', [
            { name: 'Padaria' },
            { name: 'Mercado' },
            { name: 'Farmácia' },
        ])

        await vi.runAllTimersAsync()
        const results = await promise

        expect(results).toHaveLength(3)
        expect(results.every((r) => r.category === 'OTHER' && r.type === 'EXPENSE')).toBe(true)
        // MAX_RETRIES = 3 → 4 tentativas no total, para o lote inteiro (sem split adicional)
        expect(generateContentMock).toHaveBeenCalledTimes(4)
    })
})
