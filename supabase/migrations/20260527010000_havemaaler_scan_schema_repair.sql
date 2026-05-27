-- Repair Havemåler scan schema drift without editing historical migrations.

ALTER TABLE public.garden_scan_sessions
  ADD COLUMN IF NOT EXISTS source text;

DO $$
DECLARE
  warnings_data_type text;
BEGIN
  SELECT data_type
  INTO warnings_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'garden_scan_sessions'
    AND column_name = 'warnings';

  IF warnings_data_type = 'ARRAY' THEN
    ALTER TABLE public.garden_scan_sessions
      ALTER COLUMN warnings DROP DEFAULT;

    ALTER TABLE public.garden_scan_sessions
      ALTER COLUMN warnings TYPE jsonb
      USING to_jsonb(COALESCE(warnings, ARRAY[]::text[]));
  ELSIF warnings_data_type IS NULL THEN
    ALTER TABLE public.garden_scan_sessions
      ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

UPDATE public.garden_scan_sessions
SET warnings = '[]'::jsonb
WHERE warnings IS NULL;

ALTER TABLE public.garden_scan_sessions
  ALTER COLUMN warnings SET DEFAULT '[]'::jsonb,
  ALTER COLUMN warnings SET NOT NULL;
