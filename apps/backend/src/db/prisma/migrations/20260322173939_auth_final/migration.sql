/*
  Warnings:

  - A unique constraint covering the columns `[firebaseUid]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('COORDINATOR', 'TRANSPORT_OFFICER', 'FACULTY', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "AuthAuditEventType" AS ENUM ('MOBILE_LOGIN_SUCCESS', 'MOBILE_LOGIN_FAILURE', 'MOBILE_REFRESH_SUCCESS', 'MOBILE_REFRESH_REJECTED', 'MOBILE_LOGOUT', 'LOGOUT_ALL_SESSIONS', 'DEVICE_REBOUND', 'DEVICE_MISMATCH_REJECTED', 'STALE_SESSION_REJECTED', 'FORCED_RELOGIN_REQUIRED', 'ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGIN_FAILURE', 'ADMIN_LOGOUT', 'ADMIN_ACCOUNT_LOCKED', 'SESSION_VERSION_BUMPED', 'FORCED_RELOGIN_SET', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'INVITE_SENT', 'INVITE_ACCEPTED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED', 'ADMIN_CREATED', 'ADMIN_ROLE_CHANGED', 'FIREBASE_PROVISION_SUCCESS', 'FIREBASE_PROVISION_FAILED', 'FIREBASE_PROVISION_RETRY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deviceBoundAt" TIMESTAMP(3),
ADD COLUMN     "firebaseUid" TEXT,
ADD COLUMN     "forcedReloginAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "registeredDeviceId" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "lastLoginUserAgent" TEXT,
    "passwordResetTokenHash" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "inviteTokenHash" TEXT,
    "inviteTokenExpiresAt" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_audit_events" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "eventType" "AuthAuditEventType" NOT NULL,
    "ipAddress" TEXT,
    "deviceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "auth_audit_events_actorId_createdAt_idx" ON "auth_audit_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "auth_audit_events_targetId_createdAt_idx" ON "auth_audit_events"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "auth_audit_events_eventType_createdAt_idx" ON "auth_audit_events"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_firebaseUid_key" ON "users"("firebaseUid");

-- AddForeignKey
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "audit_mobile_actor" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "audit_admin_actor" FOREIGN KEY ("actorId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
