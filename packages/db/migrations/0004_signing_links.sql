CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"signing_link_id" uuid NOT NULL,
	"item_record_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "signing_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"role" "signature_roles" NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_name" text,
	"recipient_email" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"signature_id" uuid,
	CONSTRAINT "signing_links_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "signing_links_role_chk" CHECK ("signing_links"."role" in ('landlord_agent','tenant_check_in','tenant_check_out'))
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_signing_link_id_signing_links_id_fk" FOREIGN KEY ("signing_link_id") REFERENCES "public"."signing_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_item_record_id_item_records_id_fk" FOREIGN KEY ("item_record_id") REFERENCES "public"."item_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_links" ADD CONSTRAINT "signing_links_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_links" ADD CONSTRAINT "signing_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_links" ADD CONSTRAINT "signing_links_signature_id_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_report_idx" ON "disputes" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "signing_links_report_idx" ON "signing_links" USING btree ("report_id");