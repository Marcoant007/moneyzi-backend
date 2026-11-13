import { CreditCard } from '@prisma/client';
import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import {
  CreditCardNotFoundError,
  updateCreditCardSchema,
  type UpdateCreditCardInput,
} from './credit-card.schemas';

export class UpdateCreditCardUseCase {
  constructor(private creditCardRepository: CreditCardRepository) {}

  async execute(id: string, userId: string, data: UpdateCreditCardInput): Promise<CreditCard> {
    const validatedData = updateCreditCardSchema.parse(data);

    // Só o dono edita o cartão.
    const card = await this.creditCardRepository.findById(id);
    if (!card || card.userId !== userId) {
      throw new CreditCardNotFoundError();
    }

    return await this.creditCardRepository.update(id, validatedData);
  }
}
