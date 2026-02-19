import { FastifyInstance } from 'fastify';
import { CreditCardController } from '@/application/controllers/credit-card-controller';
import { PrismaCreditCardRepository } from '@/infra/repositories/prisma/prisma-credit-card-repository';
import { PrismaUserRepository } from '@/infra/repositories/prisma/prisma-user-repository';
import { PrismaTransactionRepository } from '@/infra/repositories/prisma/prisma-transaction-repository';
import { CreateCreditCardUseCase } from '@/application/use-cases/credit-card-use-case/create-credit-card.use-case';
import { ListCreditCardsUseCase } from '@/application/use-cases/credit-card-use-case/list-credit-cards.use-case';
import { ListActiveCreditCardsUseCase } from '@/application/use-cases/credit-card-use-case/list-active-credit-cards.use-case';
import { UpdateCreditCardUseCase } from '@/application/use-cases/credit-card-use-case/update-credit-card.use-case';
import { DeleteCreditCardUseCase } from '@/application/use-cases/credit-card-use-case/delete-credit-card.use-case';
import { GetCardStatementUseCase } from '@/application/use-cases/credit-card-use-case/get-card-statement.use-case';
import { GetCardsSpendingSummaryUseCase } from '@/application/use-cases/credit-card-use-case/get-cards-spending-summary.use-case';

export async function creditCardRoutes(app: FastifyInstance) {
    const controller = buildCreditCardController();

    // Criar novo cartão
    app.post('/credit-cards', (req, reply) => controller.create(req, reply));

    // Listar todos os cartões do usuário
    app.get('/credit-cards', (req, reply) => controller.list(req, reply));

    // Listar apenas cartões ativos
    app.get('/credit-cards/active', (req, reply) => controller.listActive(req, reply));

    // Obter resumo de gastos por cartão
    app.get('/credit-cards/spending-summary', (req, reply) => controller.getSpendingSummary(req, reply));

    // Obter extrato de um cartão
    app.get('/credit-cards/:id/statement', (req, reply) => controller.getStatement(req, reply));

    // Atualizar cartão
    app.put('/credit-cards/:id', (req, reply) => controller.update(req, reply));

    // Deletar (desativar) cartão
    app.delete('/credit-cards/:id', (req, reply) => controller.delete(req, reply));
}

function buildCreditCardController(): CreditCardController {
    const creditCardRepository = new PrismaCreditCardRepository();
    const userRepository = new PrismaUserRepository();
    const transactionRepository = new PrismaTransactionRepository();

    const createUseCase = new CreateCreditCardUseCase(
        creditCardRepository,
        userRepository
    );
    const listUseCase = new ListCreditCardsUseCase(creditCardRepository);
    const listActiveUseCase = new ListActiveCreditCardsUseCase(creditCardRepository);
    const updateUseCase = new UpdateCreditCardUseCase(creditCardRepository);
    const deleteUseCase = new DeleteCreditCardUseCase(creditCardRepository);
    const getStatementUseCase = new GetCardStatementUseCase(
        creditCardRepository,
        transactionRepository
    );
    const getSpendingSummaryUseCase = new GetCardsSpendingSummaryUseCase(
        creditCardRepository,
        transactionRepository
    );

    return new CreditCardController(
        createUseCase,
        listUseCase,
        listActiveUseCase,
        updateUseCase,
        deleteUseCase,
        getStatementUseCase,
        getSpendingSummaryUseCase
    );
}
