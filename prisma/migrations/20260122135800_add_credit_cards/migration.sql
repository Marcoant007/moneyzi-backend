-- CreateEnum
CREATE TYPE "CardBrand" AS ENUM ('VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OTHER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "creditCardId" TEXT;

-- CreateTable
CREATE TABLE "CreditCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastFourDigits" TEXT,
    "brand" "CardBrand",
    "limit" DECIMAL(10,2),
    "closingDay" INTEGER,
    "dueDay" INTEGER,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditCard_userId_idx" ON "CreditCard"("userId");

-- CreateIndex
CREATE INDEX "CreditCard_userId_isActive_idx" ON "CreditCard"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Transaction_creditCardId_idx" ON "Transaction"("creditCardId");

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

