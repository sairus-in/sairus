-- AlterTable
ALTER TABLE "attendance_logs" ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lon" DOUBLE PRECISION;

-- Backfill data
UPDATE "attendance_logs" SET "lat" = "studentLat", "lon" = "studentLon";

-- Drop old columns
ALTER TABLE "attendance_logs" DROP COLUMN "studentLat", DROP COLUMN "studentLon";
