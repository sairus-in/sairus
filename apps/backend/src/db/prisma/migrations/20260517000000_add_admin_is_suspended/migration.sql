-- Add isSuspended column to AdminUser
ALTER TABLE "admin_users" ADD COLUMN "isSuspended" Boolean NOT NULL DEFAULT false;
