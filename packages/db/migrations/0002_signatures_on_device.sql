-- Guard: the type recreation below and NOT NULL visit_id need an empty/compatible signatures table.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM signatures) THEN
    RAISE EXCEPTION 'signatures has rows: migrate them by hand before 0002 (visit_id NOT NULL, methods on_device/link only)';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "signatures" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."signature_methods";--> statement-breakpoint
CREATE TYPE "public"."signature_methods" AS ENUM('on_device', 'link');--> statement-breakpoint
ALTER TABLE "signatures" ALTER COLUMN "method" SET DATA TYPE "public"."signature_methods" USING "method"::"public"."signature_methods";--> statement-breakpoint
DROP INDEX "signatures_report_role_uq";--> statement-breakpoint
ALTER TABLE "signatures" ALTER COLUMN "report_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "visit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "content_sha256" text;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "signatures" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signatures_visit_idx" ON "signatures" USING btree ("visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signatures_visit_role_on_device_uq" ON "signatures" USING btree ("visit_id","role") WHERE method = 'on_device' and deleted_at is null;