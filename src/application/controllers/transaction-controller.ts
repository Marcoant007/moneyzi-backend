import { ZodError } from 'zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ListTransactionsUseCase } from '@/application/use-cases/transaction-use-case/list-transactions.use-case'
import type { CountCurrentMonthTransactionsUseCase } from '@/application/use-cases/transaction-use-case/count-current-month.use-case'
import type { UpsertTransactionUseCase } from '@/application/use-cases/transaction-use-case/upsert-transaction.use-case'
import type { DeleteTransactionUseCase } from '@/application/use-cases/transaction-use-case/delete-transaction.use-case'
import type { UpdateMultipleTransactionsUseCase } from '@/application/use-cases/transaction-use-case/update-multiple-transactions.use-case'
import type { UpdateTransactionAmountUseCase } from '@/application/use-cases/transaction-use-case/update-transaction-amount.use-case'
import type { UpdateCardStatementAmountUseCase } from '@/application/use-cases/transaction-use-case/update-card-statement-amount.use-case'

export class TransactionController {
    constructor(
        private listUseCase: ListTransactionsUseCase,
        private countCurrentMonthUseCase: CountCurrentMonthTransactionsUseCase,
        private upsertUseCase: UpsertTransactionUseCase,
        private deleteUseCase: DeleteTransactionUseCase,
        private updateMultipleUseCase: UpdateMultipleTransactionsUseCase,
        private updateAmountUseCase: UpdateTransactionAmountUseCase,
        private updateCardStatementUseCase: UpdateCardStatementAmountUseCase,
    ) {}

    async list(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { month, year, accountId } = request.query as { month: string; year: string; accountId?: string }

            const currentMonth = month || String(new Date().getMonth() + 1).padStart(2, '0')
            const currentYear = year ? parseInt(year) : new Date().getFullYear()

            const transactions = await this.listUseCase.execute({
                userId,
                month: parseInt(currentMonth),
                year: currentYear,
                accountId: accountId && accountId !== 'all' ? accountId : undefined,
            })

            return reply.send(transactions)
        } catch (error) {
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }

    async countCurrentMonth(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const count = await this.countCurrentMonthUseCase.execute(userId)
            return reply.send({ count })
        } catch (error) {
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }

    async upsert(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const body = request.body as any
            const { id } = request.params as { id?: string }

            await this.upsertUseCase.execute({ ...body, id: id ?? body.id, userId })
            return reply.status(id ? 200 : 201).send({ success: true })
        } catch (error) {
            if (error instanceof ZodError) {
                return reply.status(400).send({ error: error.errors })
            }
            if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
                return reply.status(422).send({ error: 'INSUFFICIENT_BALANCE' })
            }
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { id } = request.params as { id: string }
            await this.deleteUseCase.execute(id, userId)
            return reply.status(204).send()
        } catch (error) {
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }

    async updateMultiple(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const body = request.body as any
            const result = await this.updateMultipleUseCase.execute({ ...body, userId })
            return reply.send(result)
        } catch (error) {
            if (error instanceof ZodError) {
                return reply.status(400).send({ error: error.errors })
            }
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }

    async updateAmount(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { id } = request.params as { id: string }
            const { amount } = request.body as { amount: number }
            await this.updateAmountUseCase.execute(id, userId, amount)
            return reply.send({ success: true })
        } catch (error) {
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }

    async updateCardStatement(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { transactionIds, newTotal } = request.body as { transactionIds: string[]; newTotal: number }
            await this.updateCardStatementUseCase.execute(userId, transactionIds, newTotal)
            return reply.send({ success: true })
        } catch (error) {
            return reply.status(500).send({ error: error instanceof Error ? error.message : 'Internal error' })
        }
    }
}
