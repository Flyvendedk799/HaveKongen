-- Phase 2: Seasonal calendar + proactive AI coach
ALTER TABLE public.plants_catalog
  ADD COLUMN IF NOT EXISTS prikle_weeks_after_sow integer,
  ADD COLUMN IF NOT EXISTS transplant_months integer[],
  ADD COLUMN IF NOT EXISTS prune_months integer[],
  ADD COLUMN IF NOT EXISTS winterize_months integer[];

CREATE TABLE IF NOT EXISTS public.daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  garden_id uuid,
  for_date date NOT NULL,
  weather text,
  summary text,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  alerts jsonb NOT NULL DEFAULT '[]'::jsonb,
  tip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, for_date)
);

ALTER TABLE public.daily_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own briefings select" ON public.daily_briefings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own briefings insert" ON public.daily_briefings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own briefings update" ON public.daily_briefings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own briefings delete" ON public.daily_briefings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_daily_briefings_user_date
  ON public.daily_briefings (user_id, for_date DESC);