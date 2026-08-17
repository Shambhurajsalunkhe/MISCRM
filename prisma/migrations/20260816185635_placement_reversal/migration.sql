-- AlterTable
ALTER TABLE "Placement" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- CreateIndex
CREATE INDEX "Placement_reversedAt_idx" ON "Placement"("reversedAt");

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
