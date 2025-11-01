import { TransactionHandler } from '../interface/transaction-handler'
import { NormalizeDescriptionHandler } from './normalize-description-handler'
import { OpenAICategorizationHandler } from './openai-categorization-handler'
import { PersistTransactionHandler } from './persist-transaction-handler'
import { PrismaUserRepository } from '@/infra/repositories/prisma/prisma-user-repository'
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository'
import { PrismaImportJobRepository } from '@/infra/repositories/prisma/prisma-import-job-repository'

export function buildTransactionHandlerChain(): TransactionHandler {
    const normalize = new NormalizeDescriptionHandler()
    const categorize = new OpenAICategorizationHandler()
    const persist = new PersistTransactionHandler(
        new PrismaUserRepository(),
        new PrismaTransactionRepository(),
        new PrismaImportJobRepository(),
    )

    normalize.setNext(categorize).setNext(persist)

    return normalize
}
