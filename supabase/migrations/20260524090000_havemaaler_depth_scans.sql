-- Havemåler depth scans and semantic 3D garden twin storage.

ALTER TABLE public.gardens
  ADD COLUMN IF NOT EXISTS depth_model jsonb,
  ADD COLUMN IF NOT EXISTS depth_model_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.garden_scan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  garden_id uuid NOT NULL REFERENCES public.gardens(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'capturing', 'uploaded', 'processing', 'ready', 'needs_anchor_correction', 'failed', 'cancelled')),
  device_model text,
  device_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  capture_client_version text,
  pipeline_version text NOT NULL DEFAULT 'garden-twin-v1',
  upload_prefix text,
  manifest_path text,
  capture_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  anchors jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_json jsonb,
  confidence numeric,
  warnings text[] NOT NULL DEFAULT '{}'::text[],
  error_code text,
  error_detail text,
  claimed_by text,
  processing_attempts integer NOT NULL DEFAULT 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  last_status_at timestamptz NOT NULL DEFAULT now(),
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  media_retention_until timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.garden_scan_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own garden scans select" ON public.garden_scan_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own garden scans insert" ON public.garden_scan_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own garden scans update" ON public.garden_scan_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own garden scans delete" ON public.garden_scan_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_garden_scan_sessions_garden_created
  ON public.garden_scan_sessions (garden_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_garden_scan_sessions_user_status
  ON public.garden_scan_sessions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_garden_scan_sessions_processing_queue
  ON public.garden_scan_sessions (status, created_at)
  WHERE status IN ('uploaded', 'processing', 'needs_anchor_correction');

DROP TRIGGER IF EXISTS garden_scan_sessions_touch ON public.garden_scan_sessions;
CREATE TRIGGER garden_scan_sessions_touch
  BEFORE UPDATE ON public.garden_scan_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.garden_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.garden_scan_sessions(id) ON DELETE CASCADE,
  garden_id uuid NOT NULL REFERENCES public.gardens(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.garden_scan_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own garden scan events select" ON public.garden_scan_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own garden scan events insert" ON public.garden_scan_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_garden_scan_events_session_created
  ON public.garden_scan_events (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_garden_scan_events_user_created
  ON public.garden_scan_events (user_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('garden-scans', 'garden-scans', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "garden scans owner select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'garden-scans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "garden scans owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'garden-scans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "garden scans owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'garden-scans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "garden scans owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'garden-scans'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
