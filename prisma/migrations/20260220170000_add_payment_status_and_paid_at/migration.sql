-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Transaction_paymentStatus_idx" ON "Transaction"("paymentStatus");

-- CreateIndex
CREATE INDEX "Transaction_userId_paymentStatus_idx" ON "Transaction"("userId", "paymentStatus");
