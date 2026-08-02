import { describe, expect, it, vi } from 'vitest'
import { GetCardItemRecommendationsUseCase } from '../deep-analysis-use-case/get-card-item-recommendations.use-case'

const CURRENT_PERIOD = '2026-08'
const INCOME = 5000

function tx(name: string, amount: number, category: string, overrides: Record<string, unknown> = {}) {
    return {
        type: 'EXPENSE',
        paymentMethod: 'CREDIT_CARD',
        name,
        amount,
        category,
        ...overrides,
    }
}

function periodFromRange(range: { start: Date }): string {
    const year = range.start.getFullYear()
    const month = String(range.start.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
}

describe('GetCardItemRecommendationsUseCase', () => {
    function buildRepository(dataset: Record<string, ReturnType<typeof tx>[]>) {
        return {
            findDashboardTransactions: vi.fn(async (_userId: string, range: { start: Date }) => {
                return dataset[periodFromRange(range)] ?? []
            }),
        } as any
    }

    it('usa a média dos últimos 3 meses como ideal quando há histórico do item', async () => {
        const dataset = {
            [CURRENT_PERIOD]: [tx('UBER', 700, 'TRANSPORTATION')],
            '2026-07': [tx('UBER', 500, 'TRANSPORTATION')],
            '2026-06': [tx('UBER', 480, 'TRANSPORTATION')],
            '2026-05': [tx('UBER', 520, 'TRANSPORTATION')],
        }
        const sut = new GetCardItemRecommendationsUseCase(buildRepository(dataset))

        const result = await sut.execute('user-1', CURRENT_PERIOD, INCOME)

        const uber = result.find((item) => item.merchant === 'UBER')
        expect(uber).toBeDefined()
        expect(uber!.baseline).toBe(500)
        expect(uber!.ideal).toBe(550)
        expect(uber!.actual).toBe(700)
        expect(uber!.reducible).toBe(150)
    })

    it('usa o teto genérico da categoria quando o item não tem histórico', async () => {
        const dataset = {
            [CURRENT_PERIOD]: [tx('IFOOD', 500, 'FOOD_DELIVERY')],
        }
        const sut = new GetCardItemRecommendationsUseCase(buildRepository(dataset))

        const result = await sut.execute('user-1', CURRENT_PERIOD, INCOME)

        const ifood = result.find((item) => item.merchant === 'IFOOD')
        expect(ifood).toBeDefined()
        expect(ifood!.baseline).toBeNull()
        expect(ifood!.ideal).toBe(250) // 5% de 5000
        expect(ifood!.reducible).toBe(250)
    })

    it('não retorna itens dentro do teto ou irrelevantes', async () => {
        const dataset = {
            [CURRENT_PERIOD]: [tx('PADARIA', 30, 'FOOD')],
        }
        const sut = new GetCardItemRecommendationsUseCase(buildRepository(dataset))

        const result = await sut.execute('user-1', CURRENT_PERIOD, INCOME)

        expect(result.find((item) => item.merchant === 'PADARIA')).toBeUndefined()
    })

    it('normaliza nomes com sufixo de parcela', async () => {
        const dataset = {
            [CURRENT_PERIOD]: [tx('NETFLIX - PARCELA 1/1', 220, 'STREAMING')],
        }
        const sut = new GetCardItemRecommendationsUseCase(buildRepository(dataset))

        const result = await sut.execute('user-1', CURRENT_PERIOD, INCOME)

        expect(result.some((item) => item.merchant === 'NETFLIX')).toBe(true)
        expect(result.some((item) => item.merchant.includes('PARCELA'))).toBe(false)
    })

    it('ordena os itens por valor redutível decrescente', async () => {
        const dataset = {
            [CURRENT_PERIOD]: [
                tx('UBER', 700, 'TRANSPORTATION'),
                tx('IFOOD', 500, 'FOOD_DELIVERY'),
                tx('NETFLIX - PARCELA 1/1', 220, 'STREAMING'),
            ],
            '2026-07': [tx('UBER', 500, 'TRANSPORTATION')],
            '2026-06': [tx('UBER', 480, 'TRANSPORTATION')],
            '2026-05': [tx('UBER', 520, 'TRANSPORTATION')],
        }
        const sut = new GetCardItemRecommendationsUseCase(buildRepository(dataset))

        const result = await sut.execute('user-1', CURRENT_PERIOD, INCOME)

        expect(result.map((item) => item.merchant)).toEqual(['IFOOD', 'UBER', 'NETFLIX'])
    })

    it('ignora despesas que não foram pagas no cartão de crédito', async () => {
        const dataset = {
            [CURRENT_PERIOD]: [tx('ALUGUEL', 2000, 'HOUSING', { paymentMethod: 'BANK_SLIP' })],
        }
        const sut = new GetCardItemRecommendationsUseCase(buildRepository(dataset))

        const result = await sut.execute('user-1', CURRENT_PERIOD, INCOME)

        expect(result).toHaveLength(0)
    })
})
