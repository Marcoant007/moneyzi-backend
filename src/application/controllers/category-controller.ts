import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { CreateCategoryUseCase } from '@/application/use-cases/category-use-case/create-category.use-case'
import { ListCategoriesUseCase } from '@/application/use-cases/category-use-case/list-categories.use-case'
import { ListCategoriesWithTransactionsUseCase } from '@/application/use-cases/category-use-case/list-categories-with-transactions.use-case'
import { UpdateCategoryUseCase } from '@/application/use-cases/category-use-case/update-category.use-case'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'

export class CategoryController {
    constructor(
        private createCategoryUseCase: CreateCategoryUseCase,
        private listCategoriesUseCase: ListCategoriesUseCase,
        private listCategoriesWithTransactionsUseCase: ListCategoriesWithTransactionsUseCase,
        private updateCategoryUseCase: UpdateCategoryUseCase,
        private deleteCategoryUseCase: DeleteCategoryUseCase
    ) { }

    async create(request: FastifyRequest, reply: FastifyReply) {
        const createCategorySchema = z.object({
            name: z.string().min(1)
        })

        const { name } = createCategorySchema.parse(request.body)
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const category = await this.createCategoryUseCase.execute({ name, userId })
            return reply.status(201).send(category)
        } catch (error: any) {
            return reply.status(400).send({ error: error.message })
        }
    }

    async list(request: FastifyRequest, reply: FastifyReply) {
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        const categories = await this.listCategoriesUseCase.execute(userId)
        return reply.send(categories)
    }

    async listWithTransactions(request: FastifyRequest, reply: FastifyReply) {
        const querySchema = z.object({
            month: z.string().optional(),
            year: z.string().optional(),
        })

        const { month, year } = querySchema.parse(request.query)
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const result = await this.listCategoriesWithTransactionsUseCase.execute({
                userId,
                month,
                year,
            })
            return reply.send(result)
        } catch (error: any) {
            request.log.error(error)
            return reply.status(500).send({ error: 'Internal server error' })
        }
    }

    async update(request: FastifyRequest, reply: FastifyReply) {
        const updateCategorySchema = z.object({
            name: z.string().min(1)
        })

        const paramsSchema = z.object({
            id: z.string().uuid()
        })

        const { name } = updateCategorySchema.parse(request.body)
        const { id } = paramsSchema.parse(request.params)
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const category = await this.updateCategoryUseCase.execute({ id, userId, name })
            return reply.send(category)
        } catch (error: any) {
            if (error.message === 'Unauthorized') {
                return reply.status(401).send({ error: error.message })
            }
            if (error.message === 'Category not found') {
                return reply.status(404).send({ error: error.message })
            }
            return reply.status(400).send({ error: error.message })
        }
    }

    async delete(request: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({
            id: z.string().uuid()
        })

        const { id } = paramsSchema.parse(request.params)
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            await this.deleteCategoryUseCase.execute({ id, userId })
            return reply.status(204).send()
        } catch (error: any) {
            if (error.message === 'Unauthorized') {
                return reply.status(401).send({ error: error.message })
            }
            if (error.message === 'Category not found') {
                return reply.status(404).send({ error: error.message })
            }
            if (error.message === 'Category has transactions') {
                return reply.status(400).send({ error: 'Não é possível excluir uma categoria que possui transações vinculadas.' })
            }
            return reply.status(400).send({ error: error.message })
        }
    }
}
