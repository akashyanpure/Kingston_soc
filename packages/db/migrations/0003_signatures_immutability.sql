-- Signatures are device-writable while the visit is not issued (same rule as other visit child
-- tables). After issue: INSERT allowed only for method = 'link' (remote signing); UPDATE/DELETE never.
-- The issue transaction sets report_id on existing rows BEFORE flipping visits.status, so it passes.
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
    IF TG_TABLE_NAME = 'signatures' THEN
      -- nested: NEW.method only exists on signatures (plpgsql AND does not short-circuit)
      IF NEW.method = 'link' THEN RETURN NEW; END IF;
    END IF;
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
CREATE TRIGGER "signatures_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "signatures"
  FOR EACH ROW EXECUTE FUNCTION soc_visit_children_immutable();
