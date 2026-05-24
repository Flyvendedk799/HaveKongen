
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  garden_id uuid REFERENCES public.gardens(id) ON DELETE SET NULL,
  provider text NOT NULL,
  kind text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'planned',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ic select" ON public.integration_connections;
CREATE POLICY "own ic select" ON public.integration_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own ic insert" ON public.integration_connections;
CREATE POLICY "own ic insert" ON public.integration_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own ic update" ON public.integration_connections;
CREATE POLICY "own ic update" ON public.integration_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own ic delete" ON public.integration_connections;
CREATE POLICY "own ic delete" ON public.integration_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS map_position jsonb;

ALTER TABLE public.plant_health_log DROP COLUMN IF EXISTS prevention;
ALTER TABLE public.plant_health_log ADD COLUMN prevention text;
