
CREATE TABLE IF NOT EXISTS public.device_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  garden_id uuid REFERENCES public.gardens(id) ON DELETE CASCADE,
  zone_id uuid,
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value numeric,
  unit text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.device_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own dr select" ON public.device_readings;
CREATE POLICY "own dr select" ON public.device_readings FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own dr insert" ON public.device_readings;
CREATE POLICY "own dr insert" ON public.device_readings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own dr update" ON public.device_readings;
CREATE POLICY "own dr update" ON public.device_readings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own dr delete" ON public.device_readings;
CREATE POLICY "own dr delete" ON public.device_readings FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.device_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  garden_id uuid REFERENCES public.gardens(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE,
  kind text,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.device_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own da select" ON public.device_actions;
CREATE POLICY "own da select" ON public.device_actions FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own da insert" ON public.device_actions;
CREATE POLICY "own da insert" ON public.device_actions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own da update" ON public.device_actions;
CREATE POLICY "own da update" ON public.device_actions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own da delete" ON public.device_actions;
CREATE POLICY "own da delete" ON public.device_actions FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.task_log ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
ALTER TABLE public.gardens ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.plant_health_log ADD COLUMN IF NOT EXISTS garden_id uuid REFERENCES public.gardens(id) ON DELETE CASCADE;
