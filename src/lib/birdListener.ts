// Fuglelytteren: pure helpers for recording-buffer handling and for merging
// AI-detected birds into the persistent animal life list (én række pr. art).

export type BirdConfidence = "high" | "medium" | "low";

export type BirdDetection = {
  name_da: string;
  latin?: string | null;
  confidence: BirdConfidence;
  sound_type?: string | null;
  reason?: string | null;
};

export type LifeListRow = {
  id: string;
  species_key: string;
  name_da: string;
  latin: string | null;
  kind: string;
  confidence: string | null;
  observation_count: number;
  first_observed_at: string;
  last_observed_at: string;
};

export type LifeListInsert = {
  user_id: string;
  garden_id: string | null;
  species_key: string;
  name_da: string;
  latin: string | null;
  kind: string;
  source: string;
  confidence: string;
  observation_count: number;
  first_observed_at: string;
  last_observed_at: string;
};

export type LifeListUpdate = {
  id: string;
  observation_count: number;
  last_observed_at: string;
  confidence: string;
  latin: string | null;
  garden_id: string | null;
};

export type LifeListUpsertPlan = {
  inserts: LifeListInsert[];
  updates: LifeListUpdate[];
  newSpeciesKeys: string[];
};

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function confidenceRank(value: string | null | undefined) {
  return value ? CONFIDENCE_RANK[value] ?? 0 : 0;
}

/** Stable key for a species: prefer the latin name, fall back to the Danish one. */
export function speciesKey(nameDa: string, latin?: string | null): string {
  const base = (latin && latin.trim()) || nameDa;
  return base
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ /g, "-");
}

/** Dedupe detections by species, keeping the highest confidence per species. */
export function dedupeDetections(detections: BirdDetection[]): BirdDetection[] {
  const byKey = new Map<string, BirdDetection>();
  for (const detection of detections) {
    if (!detection.name_da?.trim()) continue;
    const key = speciesKey(detection.name_da, detection.latin);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || confidenceRank(detection.confidence) > confidenceRank(existing.confidence)) {
      byKey.set(key, { ...existing, ...detection, latin: detection.latin ?? existing?.latin ?? null });
    }
  }
  return Array.from(byKey.values());
}

/** Plan the inserts/updates needed to merge a listening round into the life list. */
export function planLifeListUpserts(
  detections: BirdDetection[],
  existingRows: LifeListRow[],
  options: { userId: string; gardenId: string | null; nowIso: string },
): LifeListUpsertPlan {
  const rowsByKey = new Map(existingRows.map((row) => [row.species_key, row]));
  const inserts: LifeListInsert[] = [];
  const updates: LifeListUpdate[] = [];
  const newSpeciesKeys: string[] = [];

  for (const detection of dedupeDetections(detections)) {
    const key = speciesKey(detection.name_da, detection.latin);
    const existing = rowsByKey.get(key);
    if (existing) {
      updates.push({
        id: existing.id,
        observation_count: existing.observation_count + 1,
        last_observed_at: options.nowIso,
        confidence: confidenceRank(detection.confidence) > confidenceRank(existing.confidence)
          ? detection.confidence
          : existing.confidence ?? detection.confidence,
        latin: existing.latin ?? detection.latin ?? null,
        garden_id: options.gardenId,
      });
    } else {
      newSpeciesKeys.push(key);
      inserts.push({
        user_id: options.userId,
        garden_id: options.gardenId,
        species_key: key,
        name_da: detection.name_da.trim(),
        latin: detection.latin?.trim() || null,
        kind: "bird",
        source: "bird_listener",
        confidence: detection.confidence,
        observation_count: 1,
        first_observed_at: options.nowIso,
        last_observed_at: options.nowIso,
      });
    }
  }

  return { inserts, updates, newSpeciesKeys };
}

/** Concatenate the Float32 chunks a ScriptProcessor delivered during recording. */
export function concatChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Block-average downsample (mono) — enough anti-aliasing for speech/birdsong AI input. */
export function downsampleBuffer(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    result[i] = sum / (end - start);
  }
  return result;
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

/** Base64-encode without blowing the call stack on multi-MB buffers. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function confidenceLabel(value: string | null | undefined) {
  if (value === "high") return "Høj sikkerhed";
  if (value === "medium") return "Middel sikkerhed";
  if (value === "low") return "Lav sikkerhed";
  return "Ukendt sikkerhed";
}
