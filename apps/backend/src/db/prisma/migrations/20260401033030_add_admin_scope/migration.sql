-- CreateTable
CREATE TABLE "admin_scope" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "routeId" TEXT,
    "department" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_scope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_scope_adminUserId_idx" ON "admin_scope"("adminUserId");

-- CreateIndex
CREATE INDEX "admin_scope_routeId_idx" ON "admin_scope"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_scope_adminUserId_routeId_key" ON "admin_scope"("adminUserId", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_scope_adminUserId_department_key" ON "admin_scope"("adminUserId", "department");

-- AddForeignKey
ALTER TABLE "admin_scope" ADD CONSTRAINT "admin_scope_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_scope" ADD CONSTRAINT "admin_scope_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
