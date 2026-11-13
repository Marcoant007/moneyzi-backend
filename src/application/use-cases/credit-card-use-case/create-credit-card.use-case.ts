import { CreditCard } from '@prisma/client';
import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import { UserRepository } from '@/application/repositories/user-repository';
import { createCreditCardSchema, type CreateCreditCardInput } from './credit-card.schemas';

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
