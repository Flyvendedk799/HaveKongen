import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { gardenStaticSatelliteUrl, type GardenThumbnailSource } from "@/lib/gardenThumbnail";

type Props = {
  garden: GardenThumbnailSource & { name?: string | null };
  mapboxToken: string | null;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
};

export default function GardenThumbnailImage({
  garden,
  mapboxToken,
  alt,
  className,
  style,
  fallback = null,
}: Props) {
  const staticUrl = useMemo(() => gardenStaticSatelliteUrl(garden, mapboxToken), [garden, mapboxToken]);
  const primaryUrl = garden.thumbnail_url || staticUrl;
  const [src, setSrc] = useState<string | null>(primaryUrl);

  useEffect(() => {
    setSrc(primaryUrl);
  }, [primaryUrl, staticUrl]);

  if (!src) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt ?? garden.name ?? ""}
      className={className}
      style={style}
      onError={() => {
        if (garden.thumbnail_url && staticUrl && src !== staticUrl) {
          setSrc(staticUrl);
        } else {
          setSrc(null);
        }
      }}
    />
  );
}
