import { describe, it, expect, vi, beforeEach } from 'vitest'
// Imports estáticos (os vi.mock abaixo são içados antes deles): carregar o módulo
// dentro de cada teste contava no timeout de 5s e estourava no pre-push, com a
// suíte inteira rodando em paralelo.
import { ImportService } from '../import-service'
import { publishToQueue } from '@/infra/queue/rabbitmq/rabbitmq'
import { detectTransactionsBatchWithIA } from '@/core/gemini/detect-transactions-batch-with-ia'

vi.mock('@/infra/queue/rabbitmq/rabbitmq', () => ({
    publishToQueue: vi.fn(),
}))

vi.mock('@/core/gemini/detect-transactions-batch-with-ia', () => ({
    detectTransactionsBatchWithIA: vi.fn(),
}))

const categoryRepoMocks = vi.hoisted(() => ({
    listByUserId: vi.fn(),
    create: vi.fn(),
}))

vi.mock('@/infra/repositories/prisma/prisma-category-repository', () => ({
    PrismaCategoryRepository: vi.fn().mockImplementation(function (this: unknown) {
        return categoryRepoMocks
    }),
}))

describe('ImportService — CSV category takes precedence over AI', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        categoryRepoMocks.listByUserId.mockResolvedValue([])
        categoryRepoMocks.create.mockImplementation(async ({ name }: { name: string }) => ({
            id: `cat-${name.toLowerCase()}`,
            name,
        }))
    })

    it('keeps the category resolved from the CSV even when the AI batch call falls back to OTHER', async () => {

        // Simula a IA falhando e caindo no fallback do lote inteiro (comportamento
        // documentado em docs/investigacao-categorizacao-import-inter.md)
        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD' },
        ])

        const csv = Buffer.from(
            'Descrição,Valor,Data,Categoria\n"Compra Supermercado","R$ 50,00","01/02/2025","Supermercado"',
        )

        await ImportService.import(csv, 'user-1', 'job-1')

        expect(publishToQueue).toHaveBeenCalledTimes(1)
        const message = (publishToQueue as any).mock.calls[0][0]

        expect(message.category).toBe('FOOD')
        expect(message.categoryId).toBe('cat-alimentação')
        expect(categoryRepoMocks.create).toHaveBeenCalledWith({ userId: 'user-1', name: 'Alimentação' })
    })

    it('reuses an existing user category instead of creating a duplicate', async () => {

        categoryRepoMocks.listByUserId.mockResolvedValue([
            { id: 'existing-food-cat', name: 'Alimentação', userId: 'user-1' },
        ])
        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD' },
        ])

        const csv = Buffer.from(
            'Descrição,Valor,Data,Categoria\n"Compra Supermercado","R$ 50,00","01/02/2025","Supermercado"',
        )

        await ImportService.import(csv, 'user-1', 'job-1')

        const message = (publishToQueue as any).mock.calls[0][0]
        expect(message.categoryId).toBe('existing-food-cat')
        expect(categoryRepoMocks.create).not.toHaveBeenCalled()
    })

    it('only matches/caches top-level categories by name, ignoring a subcategory with the same name', async () => {

        categoryRepoMocks.listByUserId.mockResolvedValue([
            { id: 'sub-alimentacao', name: 'Alimentação', userId: 'user-1', parentId: 'some-parent' },
            { id: 'top-alimentacao', name: 'Alimentação', userId: 'user-1', parentId: null },
        ])
        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD' },
        ])

        const csv = Buffer.from(
            'Descrição,Valor,Data,Categoria\n"Compra Supermercado","R$ 50,00","01/02/2025","Supermercado"',
        )

        await ImportService.import(csv, 'user-1', 'job-1')

        const message = (publishToQueue as any).mock.calls[0][0]
        expect(message.categoryId).toBe('top-alimentacao')
        expect(categoryRepoMocks.create).not.toHaveBeenCalled()
    })

    it('falls back to the AI classification when the CSV category is not recognized', async () => {

        ;(detectTransactionsBatchWithIA as any).mockResolvedValue([
            { type: 'EXPENSE', category: 'TRANSPORTATION', paymentMethod: 'CREDIT_CARD', categoryId: 'ai-cat-1' },
        ])

        const csv = Buffer.from(
            'Descrição,Valor,Data,Categoria\n"Corrida"," R$ 20,00","01/02/2025","Categoria Nunca Vista"',
        )

        await ImportService.import(csv, 'user-1', 'job-1')

        const message = (publishToQueue as any).mock.calls[0][0]
        expect(message.category).toBe('TRANSPORTATION')
        expect(message.categoryId).toBe('ai-cat-1')
        expect(categoryRepoMocks.listByUserId).not.toHaveBeenCalled()
    })
})
