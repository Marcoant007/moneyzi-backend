import type { FastifyInstance } from 'fastify'
import { TransferController } from '@/application/controllers/transfer-controller'
import { CreateTransferUseCase } from '@/application/use-cases/transfer-use-case/create-transfer.use-case'
import { PrismaTransferRepository } from '@/infra/repositories/prisma/prisma-transfer-repository'
import { PrismaAccountRepository } from '@/infra/repositories/prisma/prisma-account-repository'

export async function transferRoutes(app: FastifyInstance) {
    const transferRepository = new PrismaTransferRepository()
    const accountRepository = new PrismaAccountRepository()
    const createTransferUseCase = new CreateTransferUseCase(transferRepository, accountRepository)
    const controller = new TransferController(createTransferUseCase)

    app.post('/transfers', (request, reply) => controller.create(request, reply))
}
