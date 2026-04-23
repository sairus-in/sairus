/*
  Warnings:

  - You are about to drop the column `arrivalCheckedAt` on the `attendance_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "attendance_logs" DROP COLUMN "arrivalCheckedAt",
ADD COLUMN     "arrivalVerifiedAt" TIMESTAMP(3);
