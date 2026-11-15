CREATE TYPE "public"."conditions" AS ENUM('G', 'F', 'P', 'U', 'NA');--> statement-breakpoint
CREATE TYPE "public"."form_version_statuses" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."roles" AS ENUM('officer', 'manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."scheme_codes" AS ENUM('PLS', 'NP', 'TF', 'PRSO');--> statement-breakpoint
CREATE TYPE "public"."signature_methods" AS ENUM('on_device', 'link', 'wet', 'officer_only');--> statement-breakpoint
CREATE TYPE "public"."signature_roles" AS ENUM('landlord_agent', 'officer', 'tenant_check_in', 'tenant_check_out');--> statement-breakpoint
CREATE TYPE "public"."tenancy_statuses" AS ENUM('pending', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."visit_statuses" AS ENUM('scheduled', 'in_progress', 'completed', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."visit_types" AS ENUM('check_in', 'check_out', 'interim');--> statement-breakpoint
CREATE TABLE "additional_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"note_date" date NOT NULL,
	"note" text NOT NULL,
	"added_by" text NOT NULL,
	"signed" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "appliances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"appliance_code" text NOT NULL,
	"make" text,
	"model" text,
	"serial" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"actor" uuid,
	"device_id" text,
	"client_updated_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "description_phrases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_code" text NOT NULL,
	"phrase" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" "form_version_statuses" DEFAULT 'draft' NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "item_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"room_instance_id" uuid,
	"item_code" text,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"qty" integer,
	"description" text,
	"condition" "conditions",
	"na_reason" text,
	"comment" text,
	"dilapidation" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('queued','running','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "landlords" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"service" text NOT NULL,
	"location" text,
	"reading_in" text,
	"reading_out" text,
	"photo_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"room_instance_id" uuid,
	"item_record_id" uuid,
	"ref" text,
	"captured_at" timestamp with time zone NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"stamp_text" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded" boolean DEFAULT false NOT NULL,
	"storage_key" text NOT NULL,
	"retention_until" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_mutations" (
	"mutation_id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"user_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uprn" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"town" text DEFAULT 'Kingston upon Thames' NOT NULL,
	"postcode" text NOT NULL,
	"property_type" text NOT NULL,
	"bedrooms" integer,
	"landlord_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_number_seq" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"report_number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf_storage_key" text,
	"sha256" text,
	"pdf_ready" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	CONSTRAINT "reports_visitId_unique" UNIQUE("visit_id"),
	CONSTRAINT "reports_reportNumber_unique" UNIQUE("report_number")
);
--> statement-breakpoint
CREATE TABLE "room_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"room_code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"wide_photo_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schemes" (
	"code" "scheme_codes" PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"role" "signature_roles" NOT NULL,
	"name" text NOT NULL,
	"method" "signature_methods" NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_sha256" text,
	"image_storage_key" text,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"scheme_code" "scheme_codes" NOT NULL,
	"tenant_name" text,
	"start_date" date,
	"end_date" date,
	"status" "tenancy_statuses" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "roles" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_general" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"field_code" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"tenancy_id" uuid,
	"scheme_code" "scheme_codes" NOT NULL,
	"visit_type" "visit_types" NOT NULL,
	"form_version_id" uuid NOT NULL,
	"officer_id" uuid NOT NULL,
	"status" "visit_statuses" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"report_number" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "visits_reportNumber_unique" UNIQUE("report_number")
);
--> statement-breakpoint
ALTER TABLE "additional_notes" ADD CONSTRAINT "additional_notes_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "additional_notes" ADD CONSTRAINT "additional_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_records" ADD CONSTRAINT "item_records_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_records" ADD CONSTRAINT "item_records_room_instance_id_room_instances_id_fk" FOREIGN KEY ("room_instance_id") REFERENCES "public"."room_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_records" ADD CONSTRAINT "item_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_room_instance_id_room_instances_id_fk" FOREIGN KEY ("room_instance_id") REFERENCES "public"."room_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_item_record_id_item_records_id_fk" FOREIGN KEY ("item_record_id") REFERENCES "public"."item_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_mutations" ADD CONSTRAINT "processed_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlord_id_landlords_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."landlords"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_instances" ADD CONSTRAINT "room_instances_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_instances" ADD CONSTRAINT "room_instances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_scheme_code_schemes_code_fk" FOREIGN KEY ("scheme_code") REFERENCES "public"."schemes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_general" ADD CONSTRAINT "visit_general_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_general" ADD CONSTRAINT "visit_general_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenancy_id_tenancies_id_fk" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_scheme_code_schemes_code_fk" FOREIGN KEY ("scheme_code") REFERENCES "public"."schemes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "additional_notes_visit_idx" ON "additional_notes" USING btree ("visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appliances_visit_code_uq" ON "appliances" USING btree ("visit_id","appliance_code");--> statement-breakpoint
CREATE INDEX "audit_events_entity_field_client_idx" ON "audit_events" USING btree ("entity_id","field","client_updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "description_phrases_item_sort_idx" ON "description_phrases" USING btree ("item_code","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "description_phrases_item_phrase_uq" ON "description_phrases" USING btree ("item_code","phrase");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_one_published_uq" ON "form_versions" USING btree ("status") WHERE status = 'published';--> statement-breakpoint
CREATE INDEX "item_records_visit_idx" ON "item_records" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "item_records_room_sort_idx" ON "item_records" USING btree ("room_instance_id","sort_order");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "meter_readings_visit_service_uq" ON "meter_readings" USING btree ("visit_id","service");--> statement-breakpoint
CREATE INDEX "photos_visit_idx" ON "photos" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "photos_item_record_idx" ON "photos" USING btree ("item_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_visit_ref_uq" ON "photos" USING btree ("visit_id","ref") WHERE ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_uprn_uq" ON "properties" USING btree ("uprn") WHERE uprn is not null;--> statement-breakpoint
CREATE INDEX "properties_postcode_lower_idx" ON "properties" USING btree (lower("postcode"));--> statement-breakpoint
CREATE INDEX "properties_landlord_idx" ON "properties" USING btree ("landlord_id");--> statement-breakpoint
CREATE INDEX "room_instances_visit_sort_idx" ON "room_instances" USING btree ("visit_id","sort_order");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signatures_report_role_uq" ON "signatures" USING btree ("report_id","role");--> statement-breakpoint
CREATE INDEX "tenancies_property_idx" ON "tenancies" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "visit_general_visit_field_uq" ON "visit_general" USING btree ("visit_id","field_code");--> statement-breakpoint
CREATE INDEX "visits_officer_scheduled_idx" ON "visits" USING btree ("officer_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "visits_property_idx" ON "visits" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "visits_status_idx" ON "visits" USING btree ("status");