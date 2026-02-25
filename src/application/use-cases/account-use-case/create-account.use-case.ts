import { z } from 'zod'
import type { Account } from '@prisma/client'
import type { AccountRepository } from '@/application/repositories/account-repository'
import type { UserRepository } from '@/application/repositories/user-repository'

const createAccountSchema = z.object({
    userId: z.string().min(1),
    name: z.string().min(1, 'Nome e obrigatorio'),
    type: z.enum(['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH', 'PIGGY_BANK', 'OTHER']).default('CHECKING'),
    initialBalance: z.number().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
})

type CreateAccountInput = z.infer<typeof createAccountSchema>

export class CreateAccountUseCase {
    constructor(
        private accountRepository: AccountRepository,
        private userRepository: UserRepository
    ) { }

    async execute(input: CreateAccountInput): Promise<Account> {
        const parsed = createAccountSchema.parse(input)

        const user = await this.userRepository.findById(parsed.userId)
        if (!user) {
            throw new Error('User not found')
        }

        return this.accountRepository.create(parsed)
    }
}
