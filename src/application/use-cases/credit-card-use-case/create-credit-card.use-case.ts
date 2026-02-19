import { z } from 'zod';
import { CreditCard } from '@prisma/client';
import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import { UserRepository } from '@/application/repositories/user-repository';

const createCreditCardSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    lastFourDigits: z.string().length(4).optional(),
    brand: z.enum(['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OTHER']).optional(),
    limit: z.number().positive().optional(),
    closingDay: z.number().min(1).max(31).optional(),
    dueDay: z.number().min(1).max(31).optional(),
    color: z.string().optional(),
    userId: z.string()
});

type CreateCreditCardInput = z.infer<typeof createCreditCardSchema>;

export class CreateCreditCardUseCase {
    constructor(
        private creditCardRepository: CreditCardRepository,
        private userRepository: UserRepository
    ) { }

    async execute(input: CreateCreditCardInput): Promise<CreditCard> {
        const validatedInput = createCreditCardSchema.parse(input);

        const user = await this.userRepository.findById(input.userId);
        if (!user) {
            throw new Error('User not found');
        }

        return await this.creditCardRepository.create(validatedInput);
    }
}
