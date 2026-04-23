CREATE TABLE "admin_trusted_devices" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "acceptLanguage" TEXT,
    "label" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIpAddress" TEXT,
    "lastIpCountry" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "admin_trusted_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_trusted_devices_adminId_deviceHash_key"
ON "admin_trusted_devices"("adminId", "deviceHash");

CREATE INDEX "admin_trusted_devices_adminId_revokedAt_idx"
ON "admin_trusted_devices"("adminId", "revokedAt");

ALTER TABLE "admin_trusted_devices"
ADD CONSTRAINT "admin_trusted_devices_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
