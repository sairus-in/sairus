-- Add isSuspended column to AdminUser
ALTER TABLE "AdminUser" ADD COLUMN "isSuspended" Boolean NOT NULL DEFAULT false;