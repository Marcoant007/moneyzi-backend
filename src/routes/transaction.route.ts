import type { FastifyInstance } from 'fastify'
import { TransactionController } from '@/application/controllers/transaction-controller'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaAccountRepository } from '@/infra/repositories/prisma/prisma-account-repository'
import { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import { CountCurrentMonthTransactionsUseCase } from '@/application/use-cases/transaction-use-case/count-current-month.use-case'
import { UpsertTransactionUseCase } from '@/application/use-cases/transaction-use-case/upsert-transaction.use-case'
import { DeleteTransactionUseCase } from '@/application/use-cases/transaction-use-case/delete-transaction.use-case'
import { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'
import { UpdateTransactionAmountUseCase } from '@/application/use-cases/transaction-use-case/update-transaction-amount.use-case'
import { UpdateCardStatementAmountUseCase } from '@/application/use-cases/transaction-use-case/update-card-statement-amount.use-case'

function buildController() {
    const transactionRepository = new PrismaTransactionRepository()
    const accountRepository = new PrismaAccountRepository()

    return new TransactionController(
        new ListTransactionsUseCase(transactionRepository),
        new CountCurrentMonthTransactionsUseCase(transactionRepository),
        new UpsertTransactionUseCase(transactionRepository, accountRepository),
        new DeleteTransactionUseCase(transactionRepository),
        new UpdateMultipleTransactionsUseCase(transactionRepository),
        new UpdateTransactionAmountUseCase(transactionRepository),
        new UpdateCardStatementAmountUseCase(transactionRepository),
    )
}

export async function transactionRoutes(app: FastifyInstance) {
    const controller = buildController()

    app.get('/transactions', (req, reply) => controller.list(req, reply))
    app.get('/transactions/count/current-month', (req, reply) => controller.countCurrentMonth(req, reply))
    app.post('/transactions', (req, reply) => controller.upsert(req, reply))
    app.put('/transactions/:id', (req, reply) => controller.upsert(req, reply))
    app.delete('/transactions/:id', (req, reply) => controller.delete(req, reply))
    app.patch('/transactions/bulk', (req, reply) => controller.updateMultiple(req, reply))
    app.patch('/transactions/:id/amount', (req, reply) => controller.updateAmount(req, reply))
    app.post('/transactions/adjust-card-statement', (req, reply) => controller.updateCardStatement(req, reply))
}
