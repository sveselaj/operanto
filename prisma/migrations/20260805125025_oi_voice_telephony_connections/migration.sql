-- CreateTable
CREATE TABLE "TelephonyConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountRef" TEXT,
    "apiKeyEncrypted" TEXT,
    "apiSecretEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelephonyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelephonyConnection_organisationId_idx" ON "TelephonyConnection"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyConnection_organisationId_provider_displayName_key" ON "TelephonyConnection"("organisationId", "provider", "displayName");

-- AddForeignKey
ALTER TABLE "TelephonyConnection" ADD CONSTRAINT "TelephonyConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
