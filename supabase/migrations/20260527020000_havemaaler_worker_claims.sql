-- Atomic Havemåler scan claiming for reconstruction workers.

CREATE OR REPLACE FUNCTION public.claim_garden_scan_session(
  p_session_id uuid,
  p_claimed_by text DEFAULT 'garden-scan-worker'
)
RETURNS SETOF public.garden_scan_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := now();
  worker_name text := left(coalesce(nullif(p_claimed_by, ''), 'garden-scan-worker'), 120);
BEGIN
  RETURN QUERY
  UPDATE public.garden_scan_sessions
  SET
    status = 'processing',
    claimed_by = worker_name,
    processing_started_at = now_ts,
    processing_finished_at = NULL,
    processing_attempts = processing_attempts + 1,
    last_status_at = now_ts,
    status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status', 'processing',
      'at', now_ts,
      'actor', 'worker',
      'reason', 'worker_claimed',
      'claimed_by', worker_name
    ))
  WHERE id = p_session_id
    AND status = 'uploaded'
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_garden_scan_session(
  p_claimed_by text DEFAULT 'garden-scan-worker'
)
RETURNS SETOF public.garden_scan_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := now();
  worker_name text := left(coalesce(nullif(p_claimed_by, ''), 'garden-scan-worker'), 120);
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT id
    FROM public.garden_scan_sessions
    WHERE status = 'uploaded'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.garden_scan_sessions s
  SET
    status = 'processing',
    claimed_by = worker_name,
    processing_started_at = now_ts,
    processing_finished_at = NULL,
    processing_attempts = s.processing_attempts + 1,
    last_status_at = now_ts,
    status_history = coalesce(s.status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status', 'processing',
      'at', now_ts,
      'actor', 'worker',
      'reason', 'worker_claimed',
      'claimed_by', worker_name
    ))
  FROM candidate
  WHERE s.id = candidate.id
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_garden_scan_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_garden_scan_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_garden_scan_session(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_garden_scan_session(text) TO service_role;
