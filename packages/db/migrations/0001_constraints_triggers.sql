-- Custom SQL migration (drizzle-kit generate --custom): what drizzle's schema DSL cannot express.
-- See docs/data-model.md. Errors raised here use SQLSTATE 'SOC01' (see src/errors.ts).

-- ── Address search: pg_trgm + trigram index (trusted extension, PG13+) ──────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "properties_address_line1_trgm_idx" ON "properties" USING gin ("address_line1" gin_trgm_ops);
--> statement-breakpoint

-- ── Deferrable photo references (a room/meter row may reference a photo inserted later in the same tx) ──
ALTER TABLE "room_instances" ADD CONSTRAINT "room_instances_wide_photo_id_photos_id_fk"
  FOREIGN KEY ("wide_photo_id") REFERENCES "photos"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_photo_id_photos_id_fk"
  FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- ── Maintenance escape hatch ──────────────────────────────────────────────────
-- `SET LOCAL soc.bypass_immutability = 'on'` inside a transaction lets an admin job (e.g. photo
-- retention purge) touch rows of an issued visit. Never used by request handlers. Reports are
-- never bypassable.
CREATE OR REPLACE FUNCTION soc_immutability_bypassed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('soc.bypass_immutability', true), '') = 'on'
$$;
--> statement-breakpoint

-- ── Visit immutability: visits table itself ──────────────────────────────────
CREATE OR REPLACE FUNCTION soc_visits_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF soc_immutability_bypassed() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'issued' THEN
      RAISE EXCEPTION 'visit % cannot be created as issued', NEW.id USING ERRCODE = 'SOC01';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'visit % is issued and immutable (% rejected)', OLD.id, TG_OP USING ERRCODE = 'SOC01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "visits_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "visits"
  FOR EACH ROW EXECUTE FUNCTION soc_visits_immutable();
--> statement-breakpoint

-- ── Visit immutability: device-writable child tables ─────────────────────────
-- Rejects INSERT/UPDATE/DELETE when the parent visit is issued. additional_notes may still be
-- INSERTed after issue (post-issue notes via POST /reports/:id/notes) but never updated/deleted.
CREATE OR REPLACE FUNCTION soc_visit_children_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids uuid[];
BEGIN
  IF soc_immutability_bypassed() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'additional_notes' THEN RETURN NEW; END IF;
    ids := ARRAY[NEW.visit_id];
  ELSIF TG_OP = 'UPDATE' THEN
    ids := ARRAY[OLD.visit_id, NEW.visit_id];
  ELSE
    ids := ARRAY[OLD.visit_id];
  END IF;
  IF EXISTS (SELECT 1 FROM visits v WHERE v.id = ANY(ids) AND v.status = 'issued') THEN
    RAISE EXCEPTION '% rejected on %: visit is issued and immutable', TG_OP, TG_TABLE_NAME USING ERRCODE = 'SOC01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "visit_general_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "visit_general"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint
CREATE TRIGGER "appliances_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "appliances"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint
CREATE TRIGGER "meter_readings_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "meter_readings"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint
CREATE TRIGGER "room_instances_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "room_instances"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint
CREATE TRIGGER "item_records_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "item_records"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint
CREATE TRIGGER "photos_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "photos"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint
CREATE TRIGGER "additional_notes_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "additional_notes"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
--> statement-breakpoint

-- ── Reports: immutable; only pdf_storage_key / sha256 (null -> value, once) and pdf_ready (false -> true) ──
CREATE OR REPLACE FUNCTION soc_reports_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'report % is immutable (DELETE rejected)', OLD.id USING ERRCODE = 'SOC01';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.visit_id IS DISTINCT FROM OLD.visit_id
     OR NEW.report_number IS DISTINCT FROM OLD.report_number
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'report % is immutable', OLD.id USING ERRCODE = 'SOC01';
  END IF;
  IF OLD.pdf_storage_key IS NOT NULL AND NEW.pdf_storage_key IS DISTINCT FROM OLD.pdf_storage_key THEN
    RAISE EXCEPTION 'report % pdf_storage_key is already set', OLD.id USING ERRCODE = 'SOC01';
  END IF;
  IF OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'report % sha256 is already set', OLD.id USING ERRCODE = 'SOC01';
  END IF;
  IF OLD.pdf_ready AND NOT NEW.pdf_ready THEN
    RAISE EXCEPTION 'report % pdf_ready cannot be unset', OLD.id USING ERRCODE = 'SOC01';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "reports_immutable" BEFORE UPDATE OR DELETE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION soc_reports_immutable();
