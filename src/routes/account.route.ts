import type { FastifyInstance } from 'fastify'
import { AccountController } from '@/application/controllers/account-controller'
import { PrismaAccountRepository } from '@/infra/repositories/prisma/prisma-account-repository'
import { PrismaUserRepository } from '@/infra/repositories/prisma/prisma-user-repository'
import { CreateAccountUseCase } from '@/application/use-cases/account-use-case/create-account.use-case'
import { ListAccountsUseCase } from '@/application/use-cases/account-use-case/list-accounts.use-case'
import { UpdateAccountUseCase } from '@/application/use-cases/account-use-case/update-account.use-case'
import { DeleteAccountUseCase } from '@/application/use-cases/account-use-case/delete-account.use-case'

export async function accountRoutes(app: FastifyInstance) {
    const controller = buildAccountController()

    app.post('/accounts', (request, reply) => controller.create(request, reply))
    app.get('/accounts', (request, reply) => controller.list(request, reply))
    app.put('/accounts/:id', (request, reply) => controller.update(request, reply))
    app.delete('/accounts/:id', (request, reply) => controller.delete(request, reply))
}

function buildAccountController() {
    const accountRepository = new PrismaAccountRepository()
    const userRepository = new PrismaUserRepository()

    const createAccountUseCase = new CreateAccountUseCase(accountRepository, userRepository)
    const listAccountsUseCase = new ListAccountsUseCase(accountRepository)
    const updateAccountUseCase = new UpdateAccountUseCase(accountRepository)
    const deleteAccountUseCase = new DeleteAccountUseCase(accountRepository)

    return new AccountController(
        createAccountUseCase,
        listAccountsUseCase,
        updateAccountUseCase,
        deleteAccountUseCase
    )
}
