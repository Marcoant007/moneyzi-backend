import { TransactionHandler } from '../interface/transaction-handler'
import { NormalizeDescriptionHandler } from './normalize-description-handler'
import { PersistTransactionHandler } from './persist-transaction-handler'
import { PrismaUserRepository } from '@/infra/repositories/prisma/prisma-user-repository'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaImportJobRepository } from '@/infra/repositories/prisma/prisma-import-job-repository'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'
import { PrismaCreditCardRepository } from '@/infra/repositories/prisma/prisma-credit-card-repository'
import { GeminiCategorizationHandler } from './gemini-categorization-handler'

export function buildTransactionHandlerChain(): TransactionHandler {
    const normalize = new NormalizeDescriptionHandler()
    const categorize = new GeminiCategorizationHandler(new PrismaCategoryRepository())
    const persist = new PersistTransactionHandler(
        new PrismaUserRepository(),
        new PrismaTransactionRepository(),
        new PrismaImportJobRepository(),
        new PrismaCreditCardRepository(),
    )

    normalize.setNext(categorize).setNext(persist)

    return normalize
}
