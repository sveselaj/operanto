-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'WHATSAPP';

-- AlterEnum
ALTER TYPE "MessageDeliveryStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "accessTokenEncrypted" TEXT,
ADD COLUMN     "displayPhoneNumber" TEXT,
ADD COLUMN     "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneNumberId" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "wabaId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientDedupeKey" TEXT;

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageTemplate_organisationId_status_idx" ON "MessageTemplate"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_organisationId_name_language_key" ON "MessageTemplate"("organisationId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_type_phoneNumberId_key" ON "ChannelConnection"("type", "phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_organisationId_clientDedupeKey_key" ON "Message"("organisationId", "clientDedupeKey");

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

