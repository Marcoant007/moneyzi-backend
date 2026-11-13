import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import { CreditCardNotFoundError } from './credit-card.schemas';

export class DeleteCreditCardUseCase {
  constructor(private creditCardRepository: CreditCardRepository) {}

  async execute(id: string, userId: string): Promise<void> {
    // Só o dono exclui o cartão. As transações dele ficam (FK SET NULL).
    const card = await this.creditCardRepository.findById(id);
    if (!card || card.userId !== userId) {
      throw new CreditCardNotFoundError();
    }

    await this.creditCardRepository.delete(id);
  }
}
