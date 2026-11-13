import { CreditCard } from '@prisma/client';
import {
    CreditCardRepository,
    CreateCreditCardData,
    UpdateCreditCardData
} from '@/core/repositories/credit-card-repository';
import { prisma } from '@/lib/prisma';

export class PrismaCreditCardRepository implements CreditCardRepository {
    async create(data: CreateCreditCardData): Promise<CreditCard> {
        return await prisma.creditCard.create({
            data: {
                ...data,
                limit: data.limit != null ? String(data.limit) : null,
            }
        });
    }

    async findById(id: string): Promise<CreditCard | null> {
        return await prisma.creditCard.findUnique({
            where: { id },
            include: {
                transactions: {
                    where: { deletedAt: null },
                    orderBy: { date: 'desc' },
                    take: 10
                }
            }
        });
    }

    async findByUserId(userId: string): Promise<CreditCard[]> {
        return await prisma.creditCard.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    // Só transações vivas — usado no aviso de exclusão.
                    select: { transactions: { where: { deletedAt: null } } }
                }
            }
        });
    }

    async findActiveByUserId(userId: string): Promise<CreditCard[]> {
        return await prisma.creditCard.findMany({
            where: {
                userId,
                isActive: true
            },
            orderBy: { name: 'asc' }
        });
    }

    async update(id: string, data: UpdateCreditCardData): Promise<CreditCard> {
        return await prisma.creditCard.update({
            where: { id },
            data: {
                ...data,
                // undefined = não mexe; null = remove o limite.
                limit: data.limit === undefined ? undefined : data.limit === null ? null : String(data.limit),
            }
        });
    }

    /**
     * Exclusão de verdade (desativar é o `isActive`, que tem botão próprio).
     * As transações do cartão NÃO são apagadas: a FK é ON DELETE SET NULL,
     * então elas continuam no app como compras no cartão sem cartão vinculado.
     */
    async delete(id: string): Promise<void> {
        await prisma.creditCard.delete({
            where: { id }
        });
    }

    async getTotalSpent(cardId: string, month: number, year: number): Promise<number> {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 1);

        const result = await prisma.transaction.aggregate({
            where: {
                creditCardId: cardId,
                type: 'EXPENSE',
                deletedAt: null,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            },
            _sum: { amount: true }
        });

        return Number(result._sum.amount || 0);
    }
}
