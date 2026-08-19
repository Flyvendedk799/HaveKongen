import { describe, expect, it } from "vitest";
import {
  concatChunks,
  dedupeDetections,
  downsampleBuffer,
  encodeWavPcm16,
  planLifeListUpserts,
  speciesKey,
  type BirdDetection,
  type LifeListRow,
} from "@/lib/birdListener";

const NOW = "2026-08-19T06:00:00.000Z";

function row(overrides: Partial<LifeListRow>): LifeListRow {
  return {
    id: "row-1",
    species_key: "turdus-merula",
    name_da: "Solsort",
    latin: "Turdus merula",
    kind: "bird",
    confidence: "medium",
    observation_count: 2,
    first_observed_at: "2026-05-01T05:00:00.000Z",
    last_observed_at: "2026-06-01T05:00:00.000Z",
    ...overrides,
  };
}

describe("speciesKey", () => {
  it("prefers the latin name and normalizes danish characters", () => {
    expect(speciesKey("Solsort", "Turdus merula")).toBe("turdus-merula");
    expect(speciesKey("Gærdesmutte")).toBe("gaerdesmutte");
    expect(speciesKey("Rødhals", "  ")).toBe("rodhals");
  });
});

describe("dedupeDetections", () => {
  it("keeps one entry per species with the highest confidence", () => {
    const detections: BirdDetection[] = [
      { name_da: "Musvit", latin: "Parus major", confidence: "low" },
      { name_da: "Musvit", latin: "Parus major", confidence: "high", sound_type: "sang" },
      { name_da: "Solsort", confidence: "medium" },
    ];
    const deduped = dedupeDetections(detections);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((d) => d.name_da === "Musvit")?.confidence).toBe("high");
  });
});

describe("planLifeListUpserts", () => {
  it("inserts unseen species and bumps counts for known ones", () => {
    const detections: BirdDetection[] = [
      { name_da: "Solsort", latin: "Turdus merula", confidence: "high" },
      { name_da: "Gærdesmutte", latin: "Troglodytes troglodytes", confidence: "medium" },
    ];
    const plan = planLifeListUpserts(detections, [row({})], {
      userId: "user-1",
      gardenId: "garden-1",
      nowIso: NOW,
    });

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      user_id: "user-1",
      garden_id: "garden-1",
      species_key: "troglodytes-troglodytes",
      name_da: "Gærdesmutte",
      kind: "bird",
      source: "bird_listener",
      observation_count: 1,
      first_observed_at: NOW,
      last_observed_at: NOW,
    });

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      id: "row-1",
      observation_count: 3,
      last_observed_at: NOW,
      confidence: "high",
    });

    expect(plan.newSpeciesKeys).toEqual(["troglodytes-troglodytes"]);
  });

  it("never downgrades a stored confidence", () => {
    const plan = planLifeListUpserts(
      [{ name_da: "Solsort", latin: "Turdus merula", confidence: "low" }],
      [row({ confidence: "high" })],
      { userId: "user-1", gardenId: null, nowIso: NOW },
    );
    expect(plan.updates[0].confidence).toBe("high");
  });
});

describe("audio buffer helpers", () => {
  it("concatenates recorder chunks in order", () => {
    const joined = concatChunks([new Float32Array([1, 2]), new Float32Array([3])]);
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });

  it("downsamples by block averaging", () => {
    const samples = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);
    const result = downsampleBuffer(samples, 8000, 4000);
    expect(result).toHaveLength(4);
    expect(Array.from(result)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("returns the input untouched when no downsampling is needed", () => {
    const samples = new Float32Array([0.1, 0.2]);
    expect(downsampleBuffer(samples, 16000, 16000)).toBe(samples);
  });

  it("encodes a valid 16-bit mono WAV header", () => {
    const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1]), 16000);
    const view = new DataView(wav.buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...wav.subarray(offset, offset + length));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint32(40, true)).toBe(8); // 4 samples * 2 bytes
    expect(wav.length).toBe(44 + 8);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(0x7fff); // clamped full scale
  });
});
