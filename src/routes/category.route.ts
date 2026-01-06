import { FastifyInstance } from 'fastify'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { CreateCategoryUseCase } from '@/application/use-cases/create-category.use-case'
import { ListCategoriesUseCase } from '@/application/use-cases/list-categories.use-case'
import { UpdateCategoryUseCase } from '@/application/use-cases/update-category.use-case'
import { DeleteCategoryUseCase } from '@/application/use-cases/delete-category.use-case'
import { CategoryController } from '@/application/controllers/category-controller'
import { ListCategoriesWithTransactionsUseCase } from '@/application/use-cases/list-categories-with-transactions.use-case'

const categoryController = buildCategoryController()

export async function categoryRoutes(app: FastifyInstance) {
    app.post('/categories', (request, reply) => categoryController.create(request, reply))
    app.get('/categories', (request, reply) => categoryController.list(request, reply))
    app.get('/categories/with-transactions', (request, reply) => categoryController.listWithTransactions(request, reply))
    app.put('/categories/:id', (request, reply) => categoryController.update(request, reply))
    app.delete('/categories/:id', (request, reply) => categoryController.delete(request, reply))
}

function buildCategoryController(): CategoryController {
    const categoryRepository = new PrismaCategoryRepository()
    const transactionRepository = new PrismaTransactionRepository()

    const createCategoryUseCase = new CreateCategoryUseCase(categoryRepository)
    const listCategoriesUseCase = new ListCategoriesUseCase(categoryRepository, transactionRepository)
    const listCategoriesWithTransactionsUseCase = new ListCategoriesWithTransactionsUseCase(categoryRepository, transactionRepository)
    const updateCategoryUseCase = new UpdateCategoryUseCase(categoryRepository)
    const deleteCategoryUseCase = new DeleteCategoryUseCase(categoryRepository)

    return new CategoryController(
        createCategoryUseCase,
        listCategoriesUseCase,
        listCategoriesWithTransactionsUseCase,
        updateCategoryUseCase,
        deleteCategoryUseCase
    )
}
