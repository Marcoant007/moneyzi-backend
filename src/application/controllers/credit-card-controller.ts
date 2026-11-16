import { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { CreateCreditCardUseCase } from '@/application/use-cases/credit-card-use-case/create-credit-card.use-case';
import { ListCreditCardsUseCase } from '@/application/use-cases/credit-card-use-case/list-credit-cards.use-case';
import { ListActiveCreditCardsUseCase } from '@/application/use-cases/credit-card-use-case/list-active-credit-cards.use-case';
import { UpdateCreditCardUseCase } from '@/application/use-cases/credit-card-use-case/update-credit-card.use-case';
import { DeleteCreditCardUseCase } from '@/application/use-cases/credit-card-use-case/delete-credit-card.use-case';
import { CreditCardNotFoundError } from '@/application/use-cases/credit-card-use-case/credit-card.schemas';
import { GetCardStatementUseCase } from '@/application/use-cases/credit-card-use-case/get-card-statement.use-case';
import { GetCardsSpendingSummaryUseCase } from '@/application/use-cases/credit-card-use-case/get-cards-spending-summary.use-case';

export class CreditCardController {
    constructor(
        private createUseCase: CreateCreditCardUseCase,
        private listUseCase: ListCreditCardsUseCase,
        private listActiveUseCase: ListActiveCreditCardsUseCase,
        private updateUseCase: UpdateCreditCardUseCase,
        private deleteUseCase: DeleteCreditCardUseCase,
        private getStatementUseCase: GetCardStatementUseCase,
        private getSpendingSummaryUseCase: GetCardsSpendingSummaryUseCase
    ) { }

    async create(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const body = request.body as any;

            const card = await this.createUseCase.execute({
                ...body,
                userId
            });

            return reply.status(201).send(card);
        } catch (error) {
            if (error instanceof ZodError) {
                return reply.status(400).send({ error: error.errors });
            }
            console.error('[CreditCardController] Error creating credit card:', error);
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error'
            });
        }
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const cards = await this.listUseCase.execute(userId);
            return reply.send(cards);
        } catch (error) {
            console.error('[CreditCardController] Error listing credit cards:', error);
            return reply.status(500).send({ error: 'Internal error' });
        }
    }

    async listActive(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const cards = await this.listActiveUseCase.execute(userId);
            return reply.send(cards);
        } catch (error) {
            console.error('[CreditCardController] Error listing active cards:', error);
            return reply.status(500).send({ error: 'Internal error' });
        }
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const { id } = request.params as { id: string };
            const body = request.body as any;

            const card = await this.updateUseCase.execute(id, userId, body);
            return reply.send(card);
        } catch (error) {
            if (error instanceof ZodError) {
                return reply.status(400).send({ error: error.errors });
            }
            if (error instanceof CreditCardNotFoundError) {
                return reply.status(404).send({ error: error.message });
            }
            console.error('[CreditCardController] Error updating credit card:', error);
            return reply.status(500).send({ error: 'Internal error' });
        }
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const { id } = request.params as { id: string };
            await this.deleteUseCase.execute(id, userId);
            return reply.status(204).send();
        } catch (error) {
            if (error instanceof CreditCardNotFoundError) {
                return reply.status(404).send({ error: error.message });
            }
            console.error('[CreditCardController] Error deleting credit card:', error);
            return reply.status(500).send({ error: 'Internal error' });
        }
    }

    async getStatement(request: FastifyRequest, reply: FastifyReply) {
        try {
            const { id } = request.params as { id: string };
            const { month, year } = request.query as { month: string; year: string };

            const userId = request.headers['x-user-id'] as string;
            const monthNumber = parseInt(month);
            const yearNumber = parseInt(year);
            if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12 || !Number.isInteger(yearNumber)) {
                return reply.status(400).send({ error: 'Mês ou ano inválido' });
            }

            const statement = await this.getStatementUseCase.execute(
                id,
                monthNumber,
                yearNumber,
                userId,
            );

            return reply.send(statement);
        } catch (error) {
            if (error instanceof Error && error.message === 'Card not found') {
                return reply.status(404).send({ error: 'Cartão não encontrado' });
            }
            console.error('[CreditCardController] Error getting statement:', error);
            return reply.status(500).send({ error: 'Internal error' });
        }
    }

    async getSpendingSummary(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const { month, year } = request.query as { month?: string; year?: string };

            const summary = await this.getSpendingSummaryUseCase.execute(
                userId,
                month ? parseInt(month) : undefined,
                year ? parseInt(year) : undefined
            );

            return reply.send(summary);
        } catch (error) {
            console.error('[CreditCardController] Error getting spending summary:', error);
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error'
            });
        }
    }
}
