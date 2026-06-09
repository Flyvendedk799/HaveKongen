import type { Tables } from "@/integrations/supabase/types";

export type GardenThumbnailSource = Pick<Tables<"gardens">, "thumbnail_url" | "latitude" | "longitude">;

type StaticSatelliteOptions = {
  width?: number;
  height?: number;
  zoom?: number;
};

function isFiniteCoordinate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value);
}

export function gardenStaticSatelliteUrl(
  garden: GardenThumbnailSource,
  mapboxToken: string | null | undefined,
  options: StaticSatelliteOptions = {},
) {
  if (!mapboxToken || !isFiniteCoordinate(garden.longitude) || !isFiniteCoordinate(garden.latitude)) {
    return null;
  }

  const width = options.width ?? 640;
  const height = options.height ?? 400;
  const zoom = options.zoom ?? 19;
  const lng = Number(garden.longitude).toFixed(6);
  const lat = Number(garden.latitude).toFixed(6);

  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${lng},${lat},${zoom},0/${width}x${height}@2x?access_token=${encodeURIComponent(mapboxToken)}`;
}
