import { CreditCardRepository } from '@/core/repositories/credit-card-repository';

export class DeleteCreditCardUseCase {
  constructor(private creditCardRepository: CreditCardRepository) {}

  async execute(id: string): Promise<void> {
    await this.creditCardRepository.delete(id);
  }
}
