import { z } from 'zod'
import type { TransactionRepository, UpsertTransactionData } from '@/application/repositories/transaction-repository'
import type { AccountRepository } from '@/application/repositories/account-repository'
import { ValidateTransactionBalanceUseCase } from './validate-transaction-balance.use-case'

const upsertTransactionSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    // Aceita valor negativo (ex.: linha de crédito/abatimento numa fatura); só não pode ser zero.
    amount: z.number().refine((value) => value !== 0, { message: 'amount must not be zero' }),
    type: z.enum(['DEPOSIT', 'EXPENSE', 'INVESTMENT']),
    category: z.enum(['HOUSING', 'TRANSPORTATION', 'FOOD', 'ENTERTAINMENT', 'HEALTH', 'UTILITY', 'SALARY', 'EDUCATION', 'OTHER', 'SIGNATURE', 'FOOD_DELIVERY', 'GAMING', 'SERVICES', 'STREAMING']),
    categoryId: z.string().optional().nullable(),
    accountId: z.string().optional().nullable(),
    creditCardId: z.string().optional().nullable(),
    paymentMethod: z.enum(['CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'BANK_SLIP', 'CASH', 'PIX', 'OTHER']),
    date: z.coerce.date(),
    dueDate: z.coerce.date().optional().nullable(),
    isRecurring: z.boolean().optional(),
    paymentStatus: z.enum(['PAID', 'PENDING']).optional(),
    userId: z.string().min(1),
})

type UpsertInput = z.infer<typeof upsertTransactionSchema>

export class UpsertTransactionUseCase {
    // Instanciado internamente (não injetado) pra manter o construtor público
    // desta classe intacto — CreateTransactionForMcpUseCase recebe a sua
    // própria instância de fora, mas o fluxo manual (transaction.route.ts) e
    // os testes existentes continuam chamando `new UpsertTransactionUseCase(tx, acc)` sem mudar nada.
    private readonly validateTransactionBalanceUseCase: ValidateTransactionBalanceUseCase

    constructor(
        private transactionRepository: TransactionRepository,
        private accountRepository: AccountRepository,
    ) {
        this.validateTransactionBalanceUseCase = new ValidateTransactionBalanceUseCase(transactionRepository, accountRepository)
    }

    async execute(input: UpsertInput): Promise<void> {
        const parsed = upsertTransactionSchema.parse(input)

        if (parsed.accountId && !parsed.id) {
            await this.validateTransactionBalanceUseCase.execute({
                userId: parsed.userId,
                accountId: parsed.accountId,
                type: parsed.type,
                amount: parsed.amount,
            })
        }

        await this.transactionRepository.upsert(parsed as UpsertTransactionData)
    }
}
