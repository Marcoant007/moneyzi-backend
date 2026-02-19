import { CreditCard, CardBrand } from '@prisma/client';

export interface CreateCreditCardData {
  name: string;
  lastFourDigits?: string;
  brand?: CardBrand;
  limit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
  userId: string;
}

export interface UpdateCreditCardData {
  name?: string;
  lastFourDigits?: string;
  brand?: CardBrand;
  limit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
  isActive?: boolean;
}

export interface CreditCardRepository {
  create(data: CreateCreditCardData): Promise<CreditCard>;
  findById(id: string): Promise<CreditCard | null>;
  findByUserId(userId: string): Promise<CreditCard[]>;
  findActiveByUserId(userId: string): Promise<CreditCard[]>;
  update(id: string, data: UpdateCreditCardData): Promise<CreditCard>;
  delete(id: string): Promise<void>;
  getTotalSpent(cardId: string, month: number, year: number): Promise<number>;
}
