import { CreditCard } from '@prisma/client';
import { CreditCardRepository } from '@/core/repositories/credit-card-repository';

export class ListActiveCreditCardsUseCase {
  constructor(private creditCardRepository: CreditCardRepository) {}

  async execute(userId: string): Promise<CreditCard[]> {
    return await this.creditCardRepository.findActiveByUserId(userId);
  }
}
