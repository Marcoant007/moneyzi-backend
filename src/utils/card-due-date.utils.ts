/**
 * Regra de "em qual fatura cai uma compra no cartão". Mesma lógica usada pelo
 * PersistTransactionHandler ao gravar `dueDate` — aqui serve de fallback para
 * transações antigas/sem `dueDate`, pra que todas as telas agrupem por fatura
 * do mesmo jeito.
 */
export class CardDueDateUtils {
    static compute(transactionDate: Date, dueDay: number, closingDay?: number): Date {
        const year = transactionDate.getFullYear()
        const month = transactionDate.getMonth()
        const txDay = transactionDate.getDate()

        // With a closing day the statement cycle is:
        //   txDay <= closingDay → belongs to CURRENT statement → paid NEXT month (+1)
        //   txDay >  closingDay → belongs to NEXT    statement → paid in 2 months  (+2)
        // Without a closing day we use the dueDay itself as the cycle boundary.
        const monthOffset = closingDay
            ? (txDay > closingDay ? 2 : 1)
            : (txDay > dueDay ? 1 : 0)

        const dueYear = year + Math.floor((month + monthOffset) / 12)
        const dueMonth = (month + monthOffset) % 12
        const lastDay = new Date(dueYear, dueMonth + 1, 0).getDate()
        const safeDueDay = Math.max(1, Math.min(dueDay, lastDay))

        // Use noon (12:00) to avoid the date shifting back one day when
        // the value is serialised to UTC and read back in UTC-3 (Brazil).
        return new Date(dueYear, dueMonth, safeDueDay, 12, 0, 0, 0)
    }

    /** `dueDate` gravado vence; senão calcula pelo dia de vencimento/fechamento do cartão. */
    static resolve(
        dueDate: Date | null,
        transactionDate: Date,
        dueDay: number | null,
        closingDay: number | null,
    ): Date | null {
        if (dueDate) return dueDate
        if (!dueDay) return null
        return CardDueDateUtils.compute(transactionDate, dueDay, closingDay ?? undefined)
    }
}
