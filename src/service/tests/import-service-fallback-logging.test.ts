import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infra/queue/rabbitmq/rabbitmq', () => ({
    publishToQueue: vi.fn(),
}))

vi.mock('@/core/gemini/detect-transactions-batch-with-ia', () => ({
    detectTransactionsBatchWithIA: vi.fn(),
}))

vi.mock('@/infra/repositories/prisma/prisma-category-repository', () => ({
    PrismaCategoryRepository: vi.fn().mockImplementation(function (this: unknown) {
        return {
            listByUserId: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
                id: `cat-${name.toLowerCase()}`,
                name,
            })),
        }
    }),
}))

const loggerMocks = vi.hoisted(() => ({
    warn: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
    default: loggerMocks,
}))

describe('ImportService — observabilidade de fallback (Etapa 3)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('loga um warn com a contagem de fallback quando a IA degrada parte da importação', async () => {
        const { ImportService } = await import('../import-service')
        const { detectTransactionsBatchWithIA } = await import('@/core/gemini/detect-transactions-batch-with-ia')

        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD', usedFallback: true },
            { type: 'EXPENSE', category: 'TRANSPORTATION', paymentMethod: 'CREDIT_CARD', categoryId: 'ai-cat-1' },
        ])

        const csv = Buffer.from(
            'Descrição,Valor,Data\n"Item sem categoria reconhecida","R$ 10,00","01/02/2025"\n"Corrida","R$ 20,00","01/02/2025"',
        )

        await ImportService.import(csv, 'user-1', 'job-1')

        expect(loggerMocks.warn).toHaveBeenCalledTimes(1)
        const [payload, message] = loggerMocks.warn.mock.calls[0]
        expect(message).toMatch(/fallback/i)
        expect(payload).toMatchObject({
            jobId: 'job-1',
            userId: 'user-1',
            total: 2,
            aiFallbackCount: 1,
            unrescuedFallbackCount: 1,
        })
    })

    it('não loga nada quando nenhuma transação usou fallback', async () => {
        const { ImportService } = await import('../import-service')
        const { detectTransactionsBatchWithIA } = await import('@/core/gemini/detect-transactions-batch-with-ia')

        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'FOOD', paymentMethod: 'CREDIT_CARD', categoryId: 'ai-cat-1' },
        ])

        const csv = Buffer.from('Descrição,Valor,Data\n"Padaria","R$ 10,00","01/02/2025"')

        await ImportService.import(csv, 'user-1', 'job-1')

        expect(loggerMocks.warn).not.toHaveBeenCalled()
    })

    it('não conta como "unrescued" quando o CSV já resolveu a categoria, mesmo com fallback de type/paymentMethod', async () => {
        const { ImportService } = await import('../import-service')
        const { detectTransactionsBatchWithIA } = await import('@/core/gemini/detect-transactions-batch-with-ia')

        // IA falhou (usedFallback), mas o CSV já reconheceu "Supermercado" → categoria não perdida
        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD', usedFallback: true },
        ])

        const csv = Buffer.from(
            'Descrição,Valor,Data,Categoria\n"Compra Supermercado","R$ 50,00","01/02/2025","Supermercado"',
        )

        await ImportService.import(csv, 'user-1', 'job-1')

        expect(loggerMocks.warn).toHaveBeenCalledTimes(1)
        const [payload] = loggerMocks.warn.mock.calls[0]
        expect(payload).toMatchObject({ aiFallbackCount: 1, unrescuedFallbackCount: 0 })
    })
})
