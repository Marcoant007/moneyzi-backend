import { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { CreateCategoryUseCase } from '@/application/use-cases/category-use-case/create-category.use-case'
import { ListCategoriesUseCase } from '@/application/use-cases/category-use-case/list-categories.use-case'
import { ListCategoriesWithTransactionsUseCase } from '@/application/use-cases/category-use-case/list-categories-with-transactions.use-case'
import { UpdateCategoryUseCase } from '@/application/use-cases/category-use-case/update-category.use-case'
import { DeleteCategoryUseCase } from '@/application/use-cases/category-use-case/delete-category.use-case'
import { DeleteCategoryWithReassignmentUseCase } from '@/application/use-cases/category-use-case/delete-category-with-reassignment.use-case'
import { CategoryStructureRollback } from '@/application/use-cases/mcp-write-use-case/category-structure-rollback'

// Só o formato: a lista de cores/ícones vive no frontend (o app cai no padrão derivado se a chave for desconhecida).
const colorSchema = z.string().regex(/^[a-z]{3,16}$/)
const iconSchema = z.string().regex(/^[a-z0-9-]{1,32}$/)

export class CategoryController {
    constructor(
        private createCategoryUseCase: CreateCategoryUseCase,
        private listCategoriesUseCase: ListCategoriesUseCase,
        private listCategoriesWithTransactionsUseCase: ListCategoriesWithTransactionsUseCase,
        private updateCategoryUseCase: UpdateCategoryUseCase,
        private deleteCategoryUseCase: DeleteCategoryUseCase,
        private deleteCategoryWithReassignmentUseCase: DeleteCategoryWithReassignmentUseCase,
        private categoryStructureRollback: CategoryStructureRollback
    ) { }

    async create(request: FastifyRequest, reply: FastifyReply) {
        const createCategorySchema = z.object({
            name: z.string().min(1),
            parentId: z.string().uuid().nullable().optional(),
            color: colorSchema.nullable().optional(),
            icon: iconSchema.nullable().optional(),
        })

        const { name, parentId, color, icon } = createCategorySchema.parse(request.body)
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const category = await this.createCategoryUseCase.execute({ name, userId, parentId, color, icon })
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
            name: z.string().min(1),
            parentId: z.string().uuid().nullable().optional(),
            color: colorSchema.nullable().optional(),
            icon: iconSchema.nullable().optional(),
        })

        const paramsSchema = z.object({
            id: z.string().uuid()
        })

        const { name, parentId, color, icon } = updateCategorySchema.parse(request.body)
        const { id } = paramsSchema.parse(request.params)
        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const category = await this.updateCategoryUseCase.execute({ id, userId, name, parentId, color, icon })
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

        // Com ?reassignTo=<id>: move TODAS as transações pra essa categoria e apaga, numa transação de banco só.
        const queryResult = z.object({ reassignTo: z.string().uuid().optional() }).safeParse(request.query)
        if (!queryResult.success) {
            return reply.status(400).send({ error: 'Categoria de destino inválida.' })
        }
        if (queryResult.data.reassignTo) {
            return this.deleteWithReassignment(reply, userId, id, queryResult.data.reassignTo)
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
            if (error.message === 'Category has children') {
                return reply.status(400).send({ error: 'Não é possível excluir uma categoria que possui subcategorias vinculadas. Exclua ou mova as subcategorias primeiro.' })
            }
            if (error.message === 'Category has transactions') {
                return reply.status(400).send({ error: 'Não é possível excluir uma categoria que possui transações vinculadas.' })
            }
            return reply.status(400).send({ error: error.message })
        }
    }

    private async deleteWithReassignment(reply: FastifyReply, userId: string, categoryId: string, reassignToId: string) {
        try {
            const result = await this.deleteCategoryWithReassignmentUseCase.execute({ userId, categoryId, reassignToId })
            return reply.status(200).send(result)
        } catch (error: any) {
            if (error.message === 'Category not found') {
                return reply.status(404).send({ error: error.message })
            }
            if (error.message === 'Category has children') {
                return reply.status(400).send({ error: 'Não é possível excluir uma categoria que possui subcategorias vinculadas. Exclua ou mova as subcategorias primeiro.' })
            }
            if (String(error.message).startsWith('CONCURRENT_MODIFICATION')) {
                return reply.status(409).send({ error: error.message })
            }
            return reply.status(400).send({ error: error.message })
        }
    }

    /** "Desfazer" de uma exclusão com reatribuição: recria a categoria (mesmo id) e devolve as transações que ainda estão no destino. */
    async rollbackOperation(request: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({
            operationId: z.string().uuid()
        })

        const paramsResult = paramsSchema.safeParse(request.params)
        if (!paramsResult.success) {
            return reply.status(400).send({ error: 'Operação inválida.' })
        }

        const userId = request.headers['x-user-id'] as string

        if (!userId) {
            return reply.status(401).send({ error: 'Unauthorized' })
        }

        try {
            const result = await this.categoryStructureRollback.execute(userId, paramsResult.data.operationId)
            return reply.send(result)
        } catch (error: any) {
            if (error.message === 'Operação não encontrada') {
                return reply.status(404).send({ error: error.message })
            }
            const message = String(error.message)
            if (error.message === 'Operação já foi revertida' || message.startsWith('ROLLBACK_BLOCKED') || message.startsWith('CONCURRENT_MODIFICATION')) {
                return reply.status(409).send({ error: error.message })
            }
            return reply.status(400).send({ error: error.message })
        }
    }
}
