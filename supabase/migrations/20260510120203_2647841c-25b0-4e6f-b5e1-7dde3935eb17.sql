-- Add photo support to user plants
ALTER TABLE public.user_plants ADD COLUMN IF NOT EXISTS image_url text;

-- Create public storage bucket for plant photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('plant-photos', 'plant-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS for plant-photos bucket
CREATE POLICY "plant photos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'plant-photos');

CREATE POLICY "users upload own plant photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'plant-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users update own plant photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'plant-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users delete own plant photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'plant-photos' AND auth.uid()::text = (storage.foldername(name))[1]);