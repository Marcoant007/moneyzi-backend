import { z } from 'zod'
import type { TransactionRepository } from '@/application/repositories/transaction-repository'

const schema = z.object({
    transactionIds: z.array(z.string()).min(1),
    category: z.enum(['HOUSING', 'TRANSPORTATION', 'FOOD', 'ENTERTAINMENT', 'HEALTH', 'UTILITY', 'SALARY', 'EDUCATION', 'OTHER', 'SIGNATURE', 'FOOD_DELIVERY', 'GAMING', 'SERVICES', 'STREAMING']).optional(),
    categoryId: z.string().optional().nullable(),
}).refine(data => data.category || data.categoryId, {
    message: 'Either category or categoryId must be provided',
})

type Input = z.infer<typeof schema> & { userId: string }

export class UpdateMultipleTransactionsUseCase {
    constructor(private transactionRepository: TransactionRepository) {}

    async execute(input: Input) {
        schema.parse(input)
        const { transactionIds, userId, category, categoryId } = input

        const updateData: { category?: any; categoryId?: string | null } = {}
        if (categoryId) {
            updateData.categoryId = categoryId
            updateData.category = 'OTHER'
        } else if (category) {
            updateData.category = category
            updateData.categoryId = null
        }

        const count = await this.transactionRepository.updateManyCategory(transactionIds, userId, updateData)
        return { updatedCount: count }
    }
}
