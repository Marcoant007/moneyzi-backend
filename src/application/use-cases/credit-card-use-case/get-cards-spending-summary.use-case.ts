import { CreditCardRepository } from '@/core/repositories/credit-card-repository';
import { TransactionRepository } from '@/application/repositories/transaction-repository';
import { CardDueDateUtils } from '@/utils/card-due-date.utils';
import { MoneyUtils } from '@/utils/money.utils';

interface CardSpending {
    cardId: string;
    cardName: string;
    lastFourDigits: string;
    brand: string;
    color: string;
    bank: string | null;
    totalSpent: number;
    transactionCount: number;
    limit: number | null;
    percentageUsed: number | null;
}

/**
 * Gasto por cartão no mês da FATURA (vencimento), não no mês da compra —
 * mesma regra do dashboard, da lista de transações e de Pagar e Receber.
 * Antes filtrava por `date`, então a fatura de novembro (compras de outubro)
 * aparecia como gasto de outubro e o mês corrente ficava zerado.
 */
export class GetCardsSpendingSummaryUseCase {
    constructor(
        private creditCardRepository: CreditCardRepository,
        private transactionRepository: TransactionRepository
    ) { }

    async execute(userId: string, month?: number, year?: number): Promise<CardSpending[]> {
        const cards = await this.creditCardRepository.findActiveByUserId(userId);
        if (cards.length === 0) {
            return [];
        }

        const now = new Date();
        const targetMonth = month ?? now.getMonth() + 1;
        const targetYear = year ?? now.getFullYear();
        const start = new Date(targetYear, targetMonth - 1, 1);
        const end = new Date(targetYear, targetMonth, 1);

        const candidates = await this.transactionRepository.findCardInvoiceCandidates(
            cards.map((card) => card.id),
            start,
            end,
        );

        const cardsById = new Map(cards.map((card) => [card.id, card]));
        const totals = new Map<string, { total: number; count: number }>();

        for (const transaction of candidates) {
            const card = transaction.creditCardId ? cardsById.get(transaction.creditCardId) : undefined;
            if (!card) continue;

            const invoiceDate = CardDueDateUtils.resolve(
                transaction.dueDate,
                transaction.date,
                card.dueDay ?? null,
                card.closingDay ?? null,
            );
            // Sem dueDate e sem dia de vencimento no cartão, a melhor aproximação
            // é o mês da própria compra.
            const effectiveDate = invoiceDate ?? transaction.date;
            if (effectiveDate < start || effectiveDate >= end) continue;

            // Estorno no cartão (DEPOSIT) abate a fatura; outros tipos não entram.
            const sign = transaction.type === 'EXPENSE' ? 1 : transaction.type === 'DEPOSIT' ? -1 : 0;
            if (sign === 0) continue;

            const entry = totals.get(card.id) ?? { total: 0, count: 0 };
            entry.total = MoneyUtils.add(entry.total, sign * Number(transaction.amount));
            entry.count += 1;
            totals.set(card.id, entry);
        }

        const summary: CardSpending[] = cards.map((card) => {
            const { total, count } = totals.get(card.id) ?? { total: 0, count: 0 };
            const limit = card.limit ? Number(card.limit) : null;
            return {
                cardId: card.id,
                cardName: card.name,
                lastFourDigits: card.lastFourDigits || '',
                brand: card.brand || 'OTHER',
                color: card.color,
                bank: card.bank ?? null,
                totalSpent: total,
                transactionCount: count,
                limit,
                percentageUsed: limit ? (total / limit) * 100 : null,
            };
        });

        return summary.sort((a, b) => b.totalSpent - a.totalSpent);
    }
}
