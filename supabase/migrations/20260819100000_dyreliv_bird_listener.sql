-- Dyreliv: Fuglelytteren og livslisten over dyr.
--
-- animal_life_list holder én række pr. bruger pr. art. Fuglelytteren (og senere
-- andre kilder) opdaterer samme række med nyt observationstal og tidspunkt, så
-- listen fungerer som en klassisk "life list" frem for en rå observationslog.

CREATE TABLE IF NOT EXISTS public.animal_life_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  garden_id uuid REFERENCES public.gardens(id) ON DELETE SET NULL,
  species_key text NOT NULL,
  name_da text NOT NULL,
  latin text,
  kind text NOT NULL DEFAULT 'bird',
  source text NOT NULL DEFAULT 'bird_listener',
  confidence text,
  notes text,
  observation_count integer NOT NULL DEFAULT 1,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, species_key)
);

ALTER TABLE public.animal_life_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own life list select" ON public.animal_life_list;
CREATE POLICY "own life list select" ON public.animal_life_list
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own life list insert" ON public.animal_life_list;
CREATE POLICY "own life list insert" ON public.animal_life_list
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own life list update" ON public.animal_life_list;
CREATE POLICY "own life list update" ON public.animal_life_list
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own life list delete" ON public.animal_life_list;
CREATE POLICY "own life list delete" ON public.animal_life_list
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_animal_life_list_user_last
  ON public.animal_life_list (user_id, last_observed_at DESC);

NOTIFY pgrst, 'reload schema';
