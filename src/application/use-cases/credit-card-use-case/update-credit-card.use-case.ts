import { z } from 'zod';
import { CreditCard } from '@prisma/client';
import { CreditCardRepository } from '@/core/repositories/credit-card-repository';

const updateCreditCardSchema = z.object({
  name: z.string().min(1).optional(),
  lastFourDigits: z.string().length(4).optional(),
  brand: z.enum(['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OTHER']).optional(),
  limit: z.number().positive().optional(),
  closingDay: z.number().min(1).max(31).optional(),
  dueDay: z.number().min(1).max(31).optional(),
  color: z.string().optional(),
  isActive: z.boolean().optional()
});

type UpdateCreditCardInput = z.infer<typeof updateCreditCardSchema>;

export class UpdateCreditCardUseCase {
  constructor(private creditCardRepository: CreditCardRepository) {}

  async execute(id: string, data: UpdateCreditCardInput): Promise<CreditCard> {
    const validatedData = updateCreditCardSchema.parse(data);
    return await this.creditCardRepository.update(id, validatedData);
  }
}
