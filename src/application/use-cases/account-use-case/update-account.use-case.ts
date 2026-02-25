import { z } from 'zod'
import type { Account } from '@prisma/client'
import type { AccountRepository } from '@/application/repositories/account-repository'

const updateAccountSchema = z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH', 'PIGGY_BANK', 'OTHER']).optional(),
    initialBalance: z.number().optional(),
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
})

type UpdateAccountInput = z.infer<typeof updateAccountSchema>

export class UpdateAccountUseCase {
    constructor(private accountRepository: AccountRepository) { }

    async execute(userId: string, id: string, input: UpdateAccountInput): Promise<Account> {
        const parsed = updateAccountSchema.parse(input)
        return this.accountRepository.update(userId, id, parsed)
    }
}
