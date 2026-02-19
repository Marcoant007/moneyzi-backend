import { CreditCard, Transaction } from '@prisma/client';
import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import { TransactionRepository } from '@/application/repositories/transaction-repository';

interface GetCardStatementOutput {
  card: CreditCard;
  transactions: Transaction[];
  totalSpent: number;
  availableLimit: number | null;
}

export class GetCardStatementUseCase {
  constructor(
    private creditCardRepository: CreditCardRepository,
    private transactionRepository: TransactionRepository
  ) {}

  async execute(
    cardId: string, 
    month: number, 
    year: number
  ): Promise<GetCardStatementOutput> {
    const card = await this.creditCardRepository.findById(cardId);
    if (!card) {
      throw new Error('Card not found');
    }
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    
    const transactions = await this.transactionRepository.findByCreditCardAndPeriod(
      cardId,
      startDate,
      endDate
    );
    
    const totalSpent = await this.creditCardRepository.getTotalSpent(
      cardId, 
      month, 
      year
    );
    
    const availableLimit = card.limit 
      ? Number(card.limit) - totalSpent 
      : null;
    
    return {
      card,
      transactions,
      totalSpent,
      availableLimit
    };
  }
}
