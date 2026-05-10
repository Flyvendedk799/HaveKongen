-- 1. Companion catalog extension
ALTER TABLE public.plants_catalog
  ADD COLUMN IF NOT EXISTS antagonist_plants text[] DEFAULT '{}'::text[];

-- 2. Garden journal table
CREATE TABLE IF NOT EXISTS public.garden_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  garden_id uuid,
  zone_id uuid,
  plant_id uuid,
  kind text NOT NULL DEFAULT 'note',
  caption text,
  image_url text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_user_created ON public.garden_journal (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_zone ON public.garden_journal (zone_id);
CREATE INDEX IF NOT EXISTS idx_journal_plant ON public.garden_journal (plant_id);

ALTER TABLE public.garden_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own journal select" ON public.garden_journal
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own journal insert" ON public.garden_journal
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own journal update" ON public.garden_journal
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own journal delete" ON public.garden_journal
  FOR DELETE TO authenticated USING (auth.uid() = user_id);