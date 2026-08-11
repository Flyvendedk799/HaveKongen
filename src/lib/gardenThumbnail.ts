import type { Tables } from "@/integrations/supabase/types";
import { ortofotoStaticUrl } from "@/lib/ortofoto";

export type GardenThumbnailSource = Pick<Tables<"gardens">, "thumbnail_url" | "latitude" | "longitude">;

type StaticSatelliteOptions = {
  width?: number;
  height?: number;
  zoom?: number;
};

function isFiniteCoordinate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Aerial thumbnail for a garden card, rendered from the ortofoto proxy. Returns
 * null when the garden has no usable coordinate.
 */
export function gardenStaticSatelliteUrl(
  garden: GardenThumbnailSource,
  options: StaticSatelliteOptions = {},
) {
  if (!isFiniteCoordinate(garden.longitude) || !isFiniteCoordinate(garden.latitude)) {
    return null;
  }

  return ortofotoStaticUrl(Number(garden.longitude), Number(garden.latitude), {
    width: options.width ?? 512,
    height: options.height ?? 320,
    zoom: options.zoom ?? 19,
  });
}
