import { OfxParser } from './parsers/ofx-parser'
import { parseCsv } from '@/utils/parse-csv'
import { publishToQueue } from '@/infra/queue/rabbitmq/rabbitmq'
import { TransactionMessage } from '@/core/types/transaction-message'
import { detectTransactionsBatchWithIA } from '@/core/gemini/detect-transactions-batch-with-ia'
import { PrismaCategoryRepository } from '@/infra/repositories/prisma/prisma-category-repository'
import type { CategoryRepository } from '@/application/repositories/category-repository'
import logger from '@/lib/logger'
import { CsvRegion, DEFAULT_CSV_REGION } from '@/core/types/csv-region'

const categoryRepository: CategoryRepository = new PrismaCategoryRepository()

export class ImportService {
    static detectType(buffer: Buffer): 'csv' | 'ofx' | 'unknown' {
        const text = buffer.toString('utf-8', 0, 200).toLowerCase()
        if (text.includes('<ofx') || text.includes('<stmttrn>')) return 'ofx'
        if (text.includes(',') || text.includes(';') || text.includes('date')) return 'csv'
        return 'unknown'
    }

    static parseOnly(buffer: Buffer, region: CsvRegion = DEFAULT_CSV_REGION): Partial<any>[] {
        const type = this.detectType(buffer)

        if (type === 'csv') return parseCsv(buffer, region)
        if (type === 'ofx') return OfxParser.parse(buffer)

        throw new Error('Tipo de arquivo nao suportado')
    }

    static async import(
        buffer: Buffer,
        userId: string,
        jobId?: string,
        creditCardId?: string,
        isCreditCardInvoice?: boolean,
        region: CsvRegion = DEFAULT_CSV_REGION,
    ) {
        const type = this.detectType(buffer)

        let parsed: Partial<any>[] = []

        if (type === 'csv') {
            parsed = parseCsv(buffer, region)
        } else if (type === 'ofx') {
            parsed = OfxParser.parse(buffer)
        } else {
            throw new Error('Tipo de arquivo nao suportado')
        }

        console.log('Parsed transactions:', parsed.length)
        console.log('First transaction sample:', JSON.stringify(parsed[0], null, 2))

        const normalizedUserId = userId.trim()
        const statementAnchorDate = this.resolveStatementAnchorDate(parsed)

        // Entradas com valor negativo em faturas de cartão representam pagamentos
        // da fatura ou créditos/estornos — não devem ser importados como despesas.
        if (isCreditCardInvoice) {
            const before = parsed.length
            parsed = parsed.filter(
                (t) => typeof t.amount === 'number' && t.amount > 0
            )
            const filtered = before - parsed.length
            if (filtered > 0) {
                console.log(`Filtered ${filtered} negative/zero-amount entries from credit card invoice`)
            }
        }

        // Pré-classifica todas as transações em batch (reduz N chamadas Gemini para ceil(N/50)).
        // type/paymentMethod sempre vêm da IA, mas quando o próprio CSV já trouxe uma categoria
        // reconhecida (ex.: coluna "Categoria" do Inter mapeada via csv-category-dictionary),
        // ela prevalece sobre o palpite da IA — inclusive se a chamada à IA falhar e cair no
        // fallback do lote inteiro (ver docs/plano-correcao-categorizacao-import-inter.md).
        const batchInputs = parsed.map((t) => ({
            name: String(t.name ?? ''),
            rawCategory: t.rawCategoryText ?? (t.category ? String(t.category) : undefined),
        }))
        const classifications = await detectTransactionsBatchWithIA(normalizedUserId, batchInputs)

        const csvCategoryIdCache = await this.buildCsvCategoryIdCache(normalizedUserId, parsed)

        let aiFallbackCount = 0
        let unrescuedFallbackCount = 0

        for (const [index, transaction] of parsed.entries()) {
            const classification = classifications[index]
            const csvCategory = transaction.category as string | undefined
            const csvCategoryName = transaction.categoryName as string | undefined
            const csvCategoryId = csvCategoryName ? csvCategoryIdCache.get(csvCategoryName.toLowerCase()) : undefined

            if (classification?.usedFallback) {
                aiFallbackCount++
                if (!csvCategory) unrescuedFallbackCount++
            }

            const message: TransactionMessage = {
                ...transaction,
                userId: normalizedUserId,
                importJobId: jobId,
                creditCardId,
                isCreditCardInvoice: Boolean(isCreditCardInvoice),
                statementAnchorDate: statementAnchorDate ?? undefined,
                type: classification?.type,
                category: (csvCategory as TransactionMessage['category']) ?? classification?.category,
                paymentMethod: classification?.paymentMethod,
                categoryId: csvCategoryId ?? classification?.categoryId,
            }

            console.log(`Sending transaction ${index + 1}/${parsed.length} to queue:`, JSON.stringify({
                userId: message.userId,
                name: message.name,
                amount: message.amount,
                date: message.date,
                creditCardId: message.creditCardId,
                isCreditCardInvoice: message.isCreditCardInvoice,
                statementAnchorDate: message.statementAnchorDate,
            }, null, 2))

            publishToQueue(message)
        }

        // Torna visível quando uma importação teve classificação degradada (IA falhou
        // e caiu no fallback) em vez de só aparecer como console.error espalhado pelo
        // servidor — ver docs/plano-correcao-categorizacao-import-inter.md, Etapa 3.
        // unrescuedFallbackCount é o que realmente incomoda o usuário: transações que
        // ficaram com categoria "Outros" porque nem o CSV nem a IA conseguiram classificar.
        if (aiFallbackCount > 0) {
            logger.warn({
                jobId,
                userId: normalizedUserId,
                total: parsed.length,
                aiFallbackCount,
                unrescuedFallbackCount,
            }, 'Importação teve classificação degradada (fallback) da IA para parte das transações')
        }

        return parsed
    }

    // Resolve (ou cria) o Category do usuário para cada nome de categoria vindo do CSV,
    // sem depender da IA. Uma única leitura das categorias existentes por import, mais
    // criação sob demanda para nomes ainda não cadastrados para esse usuário.
    private static async buildCsvCategoryIdCache(
        userId: string,
        parsed: Partial<any>[],
    ): Promise<Map<string, string>> {
        const csvCategoryNames = new Set(
            parsed
                .map((t) => t.categoryName as string | undefined)
                .filter((name): name is string => Boolean(name)),
        )

        const cache = new Map<string, string>()
        if (csvCategoryNames.size === 0) {
            return cache
        }

        const existingCategories = await categoryRepository.listByUserId(userId)
        // Só casa/cria no nível de topo: com subcategorias, nomes repetidos em
        // ramos diferentes (ex: duas "Outros" distintas) tornariam esse cache
        // ambíguo por nome, categorizando o CSV no ramo errado silenciosamente.
        for (const category of existingCategories) {
            if (category.parentId) continue
            cache.set(category.name.toLowerCase(), category.id)
        }

        for (const categoryName of csvCategoryNames) {
            const key = categoryName.toLowerCase()
            if (cache.has(key)) continue

            const created = await categoryRepository.create({ userId, name: categoryName })
            cache.set(key, created.id)
        }

        return cache
    }

    private static resolveStatementAnchorDate(parsed: Partial<any>[]): Date | null {
        const dates = parsed
            .map((transaction) => transaction.date)
            .filter((value): value is string | Date => Boolean(value))
            .map((value) => value instanceof Date ? value : new Date(value))
            .filter((value) => !Number.isNaN(value.getTime()))

        if (!dates.length) {
            return null
        }

        return new Date(Math.max(...dates.map((value) => value.getTime())))
    }
}
