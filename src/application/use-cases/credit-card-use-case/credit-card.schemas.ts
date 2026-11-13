import { z } from 'zod';

/**
 * Validação única de cartão (criar e editar).
 *
 * `limit: null` é válido e significa "sem limite" — o formulário manda null
 * quando o campo fica vazio. Antes o schema só aceitava número e o update
 * gravava `String(null)` no Decimal, estourando 500.
 */
export const CARD_BRANDS = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'DINERS', 'DISCOVER', 'OTHER'] as const;

const day = z.number().int('Dia deve ser inteiro').min(1, 'Dia entre 1 e 31').max(31, 'Dia entre 1 e 31');

const cardFields = {
    name: z.string().trim().min(1, 'Nome é obrigatório').max(60, 'Nome muito longo'),
    lastFourDigits: z.string().regex(/^\d{4}$/, 'Informe os 4 últimos dígitos'),
    brand: z.enum(CARD_BRANDS),
    limit: z
        .number()
        .positive('Limite deve ser maior que zero')
        .max(10_000_000, 'Limite muito alto')
        .nullable(),
    closingDay: day.nullable(),
    dueDay: day.nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
    // Chave do tema do banco no frontend (ex: "nubank"); vazio vira null.
    bank: z
        .string()
        .trim()
        .max(40)
        .nullable()
        .transform((value) => (value ? value : null)),
};

export const createCreditCardSchema = z.object({
    name: cardFields.name,
    lastFourDigits: cardFields.lastFourDigits.optional(),
    brand: cardFields.brand.optional(),
    limit: cardFields.limit.optional(),
    closingDay: cardFields.closingDay.optional(),
    dueDay: cardFields.dueDay.optional(),
    color: cardFields.color.optional(),
    bank: cardFields.bank.optional(),
    userId: z.string().min(1),
});

export const updateCreditCardSchema = z
    .object({
        name: cardFields.name.optional(),
        lastFourDigits: cardFields.lastFourDigits.optional(),
        brand: cardFields.brand.optional(),
        limit: cardFields.limit.optional(),
        closingDay: cardFields.closingDay.optional(),
        dueDay: cardFields.dueDay.optional(),
        color: cardFields.color.optional(),
        bank: cardFields.bank.optional(),
        isActive: z.boolean().optional(),
    })
    .strip();

export type CreateCreditCardInput = z.infer<typeof createCreditCardSchema>;
export type UpdateCreditCardInput = z.infer<typeof updateCreditCardSchema>;

export class CreditCardNotFoundError extends Error {
    constructor() {
        super('Cartão não encontrado');
        this.name = 'CreditCardNotFoundError';
    }
}
