import { TransactionHandler } from '../interface/transaction-handler'
import { NormalizeDescriptionHandler } from './normalize-description-handler'
import { OpenAICategorizationHandler } from './openai-categorization-handler'
import { PersistTransactionHandler } from './persist-transaction-handler'

export function buildTransactionHandlerChain(): TransactionHandler {
    const normalize = new NormalizeDescriptionHandler()
    const categorize = new OpenAICategorizationHandler()
    const persist = new PersistTransactionHandler()

    normalize.setNext(categorize).setNext(persist)

    return normalize
}
