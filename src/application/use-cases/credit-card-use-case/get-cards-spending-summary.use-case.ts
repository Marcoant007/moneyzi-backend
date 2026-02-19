import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import { TransactionRepository } from '@/application/repositories/transaction-repository';

interface CardSpending {
    cardId: string;
    cardName: string;
    lastFourDigits: string;
    brand: string;
    color: string;
    totalSpent: number;
    transactionCount: number;
    limit: number | null;
    percentageUsed: number | null;
}

export class GetCardsSpendingSummaryUseCase {
    constructor(
        private creditCardRepository: CreditCardRepository,
        private transactionRepository: TransactionRepository
    ) { }

    async execute(userId: string, month?: number, year?: number): Promise<CardSpending[]> {
        // Pega todos os cartões ativos do usuário
        const cards = await this.creditCardRepository.findActiveByUserId(userId);

        if (cards.length === 0) {
            return [];
        }

        const summary: CardSpending[] = [];

        // Define o período (se não fornecido, usa o mês atual)
        const now = new Date();
        const targetMonth = month ?? now.getMonth() + 1;
        const targetYear = year ?? now.getFullYear();

        for (const card of cards) {
            // Busca transações do cartão
            const transactions = await this.transactionRepository.findByCreditCardId(
                card.id,
                targetMonth,
                targetYear
            );

            // Calcula o total gasto
            const totalSpent = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

            const limit = card.limit ? Number(card.limit) : null;
            const percentageUsed = limit
                ? (totalSpent / limit) * 100
                : null;

            summary.push({
                cardId: card.id,
                cardName: card.name,
                lastFourDigits: card.lastFourDigits || '',
                brand: card.brand || 'OTHER',
                color: card.color,
                totalSpent,
                transactionCount: transactions.length,
                limit,
                percentageUsed
            });
        }

        // Ordena por maior gasto
        return summary.sort((a, b) => b.totalSpent - a.totalSpent);
    }
}
