import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateTransferUseCase } from '@/application/use-cases/transfer-use-case/create-transfer.use-case'

export class TransferController {
    constructor(private readonly createTransferUseCase: CreateTransferUseCase) {}

    async create(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { fromAccountId, toAccountId, amount, note, date } = request.body as any

            const transfer = await this.createTransferUseCase.execute({
                userId,
                fromAccountId,
                toAccountId,
                amount: Number(amount),
                note,
                date: date ? new Date(date) : undefined,
            })

            return reply.status(201).send(transfer)
        } catch (error) {
            if (error instanceof Error) {
                if (error.message === 'FROM_EQUALS_TO') {
                    return reply.status(400).send({ error: 'Conta de origem e destino não podem ser iguais' })
                }
                if (error.message === 'INVALID_AMOUNT') {
                    return reply.status(400).send({ error: 'Valor deve ser maior que zero' })
                }
                if (error.message === 'FROM_ACCOUNT_NOT_FOUND' || error.message === 'TO_ACCOUNT_NOT_FOUND') {
                    return reply.status(404).send({ error: 'Conta não encontrada' })
                }
            }

            return reply.status(500).send({ error: 'Erro ao criar transferência' })
        }
    }
}
