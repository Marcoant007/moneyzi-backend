import { FastifyRequest, FastifyReply } from 'fastify';
import { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case';
import { SettlePayableUseCase } from '@/application/use-cases/payables-use-case/settle-payable.use-case';
import type { PaymentStatus } from '@prisma/client';

export class PayablesController {
    constructor(
        private getUseCase: GetPayablesReceivablesUseCase,
        private settleUseCase: SettlePayableUseCase,
    ) { }

    async getPayablesReceivables(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string;
            const { month, year, status } = request.query as {
                month?: string;
                year?: string;
                status?: string;
            };

            const result = await this.getUseCase.execute({
                userId,
                month: month ? parseInt(month) : undefined,
                year: year ? parseInt(year) : undefined,
                status: status as PaymentStatus | undefined,
            });

            return reply.send(result);
        } catch (error) {
            console.error('[PayablesController] Error getting payables/receivables:', error);
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error',
            });
        }
    }

    async settle(request: FastifyRequest, reply: FastifyReply) {
        try {
            const body = request.body as {
                mode: 'PAY' | 'UNPAY';
                scope: 'TRANSACTION' | 'CARD_STATEMENT';
                transactionId?: string;
                card?: { creditCardId: string; dueDate: string };
            };

            const result = await this.settleUseCase.execute(body);
            return reply.send(result);
        } catch (error) {
            console.error('[PayablesController] Error settling payable:', error);
            if (error instanceof Error && (
                error.message.includes('required') ||
                error.message.includes('No transactions')
            )) {
                return reply.status(400).send({ error: error.message });
            }
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error',
            });
        }
    }
}
