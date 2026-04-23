ALTER TABLE "messages"
ADD COLUMN "tripId" TEXT,
ADD COLUMN "incidentId" TEXT,
ADD COLUMN "contextType" TEXT,
ADD COLUMN "contextId" TEXT;

CREATE INDEX "messages_routeId_idx" ON "messages"("routeId");
CREATE INDEX "messages_tripId_idx" ON "messages"("tripId");
CREATE INDEX "messages_incidentId_idx" ON "messages"("incidentId");
CREATE INDEX "messages_contextType_contextId_idx" ON "messages"("contextType", "contextId");
