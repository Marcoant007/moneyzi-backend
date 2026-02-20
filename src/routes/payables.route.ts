import { FastifyInstance } from 'fastify';
import { PayablesController } from '@/application/controllers/payables-controller';
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository';
import { GetPayablesReceivablesUseCase } from '@/application/use-cases/payables-use-case/get-payables-receivables.use-case';
import { SettlePayableUseCase } from '@/application/use-cases/payables-use-case/settle-payable.use-case';

export async function payablesRoutes(app: FastifyInstance) {
    const controller = buildPayablesController();

    // GET /payables-receivables?month=2&year=2026&status=PENDING
    app.get('/payables-receivables', (req, reply) =>
        controller.getPayablesReceivables(req, reply)
    );

    // PATCH /payables-receivables/settle
    app.patch('/payables-receivables/settle', (req, reply) =>
        controller.settle(req, reply)
    );
}

function buildPayablesController(): PayablesController {
    const transactionRepository = new PrismaTransactionRepository();

    const getUseCase = new GetPayablesReceivablesUseCase(transactionRepository);
    const settleUseCase = new SettlePayableUseCase(transactionRepository);

    return new PayablesController(getUseCase, settleUseCase);
}
