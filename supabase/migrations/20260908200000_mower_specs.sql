-- Robot mower specifications.
--
-- Havemåler step 2 measures a garden's area, slope, obstacles and tightest
-- passage. To turn that into "this machine will work and that one won't", the
-- catalogue has to say what each machine can actually cope with — which until
-- now it did not, so the 3D builder collected the evidence and had nothing to
-- compare it against.
--
-- Stored as JSONB rather than columns because it only applies to one category,
-- and a check constraint keeps it honest.

alter table public.products
  add column if not exists mower_specs jsonb;

comment on column public.products.mower_specs is
  'Robot mower capability, matched against a garden''s MowerProfile in src/lib/mowerFit.ts. '
  'Shape: { maxAreaM2, maxSlopePct, minPassageCm, zones?, obstacleAvoidance?, needsGuideWire?, cuttingWidthCm? }. '
  'Null for anything that is not a mower.';

-- Either absent, or complete enough to judge a garden against. A half-filled
-- spec would silently drop the product out of the recommendations, which is
-- worse than a loud failure.
--
-- Every key test is wrapped in coalesce() on purpose. A CHECK constraint passes
-- when its expression evaluates to NULL rather than false, and jsonb_typeof()
-- of a *missing* key returns NULL — so the obvious spelling of this constraint
-- accepts exactly the incomplete specs it was written to reject.
alter table public.products drop constraint if exists products_mower_specs_shape;

alter table public.products add constraint products_mower_specs_shape check (
  mower_specs is null or (
    jsonb_typeof(mower_specs) = 'object'
    and coalesce(jsonb_typeof(mower_specs -> 'maxAreaM2'), '') = 'number'
    and coalesce(jsonb_typeof(mower_specs -> 'maxSlopePct'), '') = 'number'
    and coalesce(jsonb_typeof(mower_specs -> 'minPassageCm'), '') = 'number'
    and (mower_specs ->> 'maxAreaM2')::numeric > 0
    and (mower_specs ->> 'maxSlopePct')::numeric between 0 and 100
    and (mower_specs ->> 'minPassageCm')::numeric between 10 and 200
  )
);

-- The recommendation query filters on this; it is a small table but the partial
-- index keeps it honest as the catalogue grows.
create index if not exists products_mower_specs_idx
  on public.products ((mower_specs is not null))
  where mower_specs is not null and active;
