
DROP POLICY IF EXISTS "product-media public read" ON storage.objects;
CREATE POLICY "product-media admin list" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-media' AND has_role(auth.uid(),'admin'));
