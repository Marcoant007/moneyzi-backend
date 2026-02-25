import { ZodError } from 'zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { CreateAccountUseCase } from '@/application/use-cases/account-use-case/create-account.use-case'
import { ListAccountsUseCase } from '@/application/use-cases/account-use-case/list-accounts.use-case'
import { UpdateAccountUseCase } from '@/application/use-cases/account-use-case/update-account.use-case'
import { DeleteAccountUseCase } from '@/application/use-cases/account-use-case/delete-account.use-case'

export class AccountController {
    constructor(
        private createAccountUseCase: CreateAccountUseCase,
        private listAccountsUseCase: ListAccountsUseCase,
        private updateAccountUseCase: UpdateAccountUseCase,
        private deleteAccountUseCase: DeleteAccountUseCase
    ) { }

    async create(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const body = request.body as any

            const account = await this.createAccountUseCase.execute({
                ...body,
                userId,
            })

            return reply.status(201).send(account)
        } catch (error) {
            if (error instanceof ZodError) {
                return reply.status(400).send({ error: error.errors })
            }

            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error',
            })
        }
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const result = await this.listAccountsUseCase.execute(userId)
            return reply.send(result)
        } catch (error) {
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error',
            })
        }
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { id } = request.params as { id: string }
            const body = request.body as any

            const account = await this.updateAccountUseCase.execute(userId, id, body)
            return reply.send(account)
        } catch (error) {
            if (error instanceof ZodError) {
                return reply.status(400).send({ error: error.errors })
            }

            if (error instanceof Error && error.message === 'Account not found') {
                return reply.status(404).send({ error: error.message })
            }

            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error',
            })
        }
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.headers['x-user-id'] as string
            const { id } = request.params as { id: string }

            await this.deleteAccountUseCase.execute(userId, id)
            return reply.status(204).send()
        } catch (error) {
            if (error instanceof Error && error.message === 'Account not found') {
                return reply.status(404).send({ error: error.message })
            }

            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Internal error',
            })
        }
    }
}
