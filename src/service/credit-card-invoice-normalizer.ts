// Normaliza as linhas de uma fatura de cartão importada (CSV/OFX) antes de virarem
// transações. Cada banco exporta a fatura com uma convenção de sinal diferente:
//   - Nubank e afins: compra positiva, pagamento da fatura negativo.
//   - OFX padrão (e alguns CSVs): compra NEGATIVA, pagamento/estorno positivo.
//   - Alguns bancos: pagamento da fatura positivo, igual às compras.
// Antes, o import só descartava valores <= 0, o que (a) deixava passar pagamentos
// positivos — uma fatura de R$ 4.000 paga virava R$ 8.000 — e (b) descartava TODAS
// as compras quando o arquivo usava a convenção "compra negativa".

export interface InvoiceRowLike {
    name?: unknown
    amount?: unknown
}

export interface NormalizeInvoiceResult<T> {
    rows: T[]
    removedPayments: number
    removedCredits: number
    flippedSign: boolean
}

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

// Descrições que os bancos usam para o PAGAMENTO DA PRÓPRIA FATURA (não é compra
// nem estorno). Testadas sobre o texto normalizado: minúsculo, sem acento e com
// pontuação trocada por espaço ("PAGTO. DEB EM C/C" -> "pagto deb em c c").
const INVOICE_PAYMENT_PATTERNS: RegExp[] = [
    // "Pagamento recebido", "Pagamento efetuado", "Pagamento on line", "Pagamento de/da fatura",
    // "Pagamento debito automatico", "Pagamento em conta"
    /\bpagamento (recebido|efetuado|on ?line|online|de fatura|da fatura|fatura|debito automatico|deb automatico|em conta|via boleto|boleto)\b/,
    // "PAGTO DEBITO AUTOMATICO", "PGTO FATURA", "PAGTO POR DEB EM C C".
    // "pag" sozinho fica de fora: "PAG*Loja" é o prefixo de compras via PagSeguro.
    /\b(pagto|pgto)\b.*\b(fatura|debito|deb|recebido|em c c)\b/,
    /\bpag fatura\b/,
    // "DEB AUTOM DE FATURA EM C C", "Debito automatico fatura"
    /\bdeb(ito)? autom(atico)?\b.*\bfatura\b/,
    // C6: "Inclusao de Pagamento"
    /\binclusao de pagamento\b/,
    // EUA: "PAYMENT - THANK YOU", "AUTOPAY PAYMENT", "ONLINE PAYMENT", "PAYMENT RECEIVED"
    /\bpayment\b.*\b(thank you|received|autopay)\b/,
    /\b(autopay|online|mobile|ach|electronic|epay)\b.*\bpayment\b/,
    /\bpymt\b/,
]

// Saldo que veio da fatura ANTERIOR (não paga ou paga parcialmente). Esse valor já
// foi contado na fatura passada; somar de novo duplica o mês. Ex.: Nubank lança
// "Valor pendente do mês anterior 383,02" junto do "Pagamento recebido -383,03".
// Juros/multa/IOF "por fatura atrasada" NÃO entram aqui: são cobranças novas.
const PREVIOUS_BALANCE_PATTERNS: RegExp[] = [
    // Nubank: "Valor pendente do mês anterior"
    /\bvalor pendente\b/,
    // "Saldo anterior", "Saldo da fatura anterior", "Saldo em atraso", "Saldo devedor anterior"
    /\bsaldo (anterior|da fatura anterior|fatura anterior|em atraso|devedor anterior|remanescente)\b/,
    // "Restante da fatura anterior", "Valor da fatura anterior"
    /\b(restante|valor|debito) da fatura anterior\b/,
    // EUA: "PREVIOUS BALANCE"
    /\bprevious balance\b/,
]

export function isInvoicePaymentDescription(name: unknown): boolean {
    if (typeof name !== 'string' || !name.trim()) return false
    const text = normalizeText(name)
    return INVOICE_PAYMENT_PATTERNS.some((pattern) => pattern.test(text))
}

export function isPreviousBalanceDescription(name: unknown): boolean {
    if (typeof name !== 'string' || !name.trim()) return false
    const text = normalizeText(name)
    return PREVIOUS_BALANCE_PATTERNS.some((pattern) => pattern.test(text))
}

function amountOf(row: InvoiceRowLike): number | null {
    return typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null
}

export function normalizeCreditCardInvoiceRows<T extends InvoiceRowLike>(
    rows: T[],
): NormalizeInvoiceResult<T> {
    // 1. Pagamento da fatura e saldo da fatura anterior saem pela descrição,
    //    independentemente do sinal.
    const withoutPayments = rows.filter(
        (row) => !isInvoicePaymentDescription(row.name) && !isPreviousBalanceDescription(row.name),
    )
    const removedPayments = rows.length - withoutPayments.length

    // 2. Descobre a convenção de sinal do arquivo: numa fatura, compras são a maioria
    //    das linhas. Se a maioria é negativa, o arquivo usa "compra negativa" e os
    //    sinais são invertidos para o padrão interno (compra = positivo).
    let positives = 0
    let negatives = 0
    for (const row of withoutPayments) {
        const amount = amountOf(row)
        if (amount === null || amount === 0) continue
        if (amount > 0) positives++
        else negatives++
    }
    const flippedSign = negatives > positives

    const signed = flippedSign
        ? withoutPayments.map((row) => {
            const amount = amountOf(row)
            return amount === null ? row : { ...row, amount: -amount }
        })
        : withoutPayments

    // 3. Mantém só compras. Créditos (estornos/ajustes) continuam fora, como antes:
    //    as telas de contas a pagar/receber ainda não tratam crédito de cartão de
    //    forma consistente.
    const purchases = signed.filter((row) => {
        const amount = amountOf(row)
        return amount !== null && amount > 0
    })
    const removedCredits = signed.length - purchases.length

    return { rows: purchases, removedPayments, removedCredits, flippedSign }
}
