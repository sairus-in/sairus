CREATE TABLE "notification_drops" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "userIds" TEXT[],
    "channels" TEXT[],
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "droppedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_drops_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_drops_requestId_idx" ON "notification_drops"("requestId");
CREATE INDEX "notification_drops_droppedAt_idx" ON "notification_drops"("droppedAt");
