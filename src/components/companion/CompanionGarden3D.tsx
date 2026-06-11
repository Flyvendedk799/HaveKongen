import { useEffect, useMemo, useRef, useState } from "react";
import "./CompanionGarden3D.css";

/**
 * CompanionGarden3D — an embeddable, procedural isometric garden diorama for the
 * Havekompagnon page. Faux-3D rendered on a 2D canvas (no WebGL, no model
 * downloads, no network). Three modes: beds, plants and watering.
 *
 * Integration example (maps the page's garden_zones / user_plants):
 *
 *   const beds = zones.map((z) => ({
 *     id: z.id,
 *     name: z.name,
 *     areaM2: z.area_m2 ?? 0,
 *     sun: (z.sun_exposure ?? "sun") as "sun" | "part" | "shade",
 *     soil: (z.soil ?? "loam") as "sand" | "loam" | "clay",
 *     plants: (plantsByZone[z.id] ?? []).map((p) => ({
 *       id: p.id,
 *       name: p.custom_name || p.name_da || "Plante",
 *       waterNeed: (p.water_need ?? "medium") as "low" | "medium" | "high",
 *       qty: p.qty,
 *     })),
 *     nextWatering: nextTimeForZone(z.id), // "06:30" | null
 *   }));
 *
 *   <CompanionGarden3D beds={beds} mode={view} onModeChange={switchView} onSelectBed={setBedId} />
 */

export type CompanionGarden3DMode = "beds" | "plants" | "water";

export type CompanionGarden3DPlant = {
  id: string;
  name: string;
  waterNeed: "low" | "medium" | "high";
  qty: number;
};

export type CompanionGarden3DBed = {
  id: string;
  name: string;
  areaM2: number;
  sun: "sun" | "part" | "shade";
  soil: "sand" | "loam" | "clay";
  plants: CompanionGarden3DPlant[];
  nextWatering?: string | null;
};

export type CompanionGarden3DProps = {
  beds?: CompanionGarden3DBed[];
  selectedBedId?: string | null;
  mode?: CompanionGarden3DMode;
  onSelectBed?: (id: string) => void;
  onModeChange?: (mode: CompanionGarden3DMode) => void;
};

const SUN_LABEL: Record<string, string> = { sun: "Fuld sol", part: "Halvskygge", shade: "Skygge" };
const SOIL_LABEL: Record<string, string> = { sand: "Sandet", loam: "Muld", clay: "Leret" };
const WATER_LABEL: Record<string, string> = { low: "Lav", medium: "Middel", high: "Høj" };

type IconType = "herb" | "tomato" | "salat";
function plantIconType(name: string): IconType {
  const n = name.toLowerCase();
  if (n.includes("tomat")) return "tomato";
  if (n.includes("salat") || n.includes("lettuce") || n.includes("spinat")) return "salat";
  return "herb";
}

const DEMO_BEDS: CompanionGarden3DBed[] = [
  {
    id: "b1", name: "Krydderi-bed", areaM2: 1.2, sun: "sun", soil: "loam",
    plants: [
      { id: "p1", name: "Basilikum", waterNeed: "medium", qty: 4 },
      { id: "p2", name: "Timian", waterNeed: "low", qty: 3 },
      { id: "p3", name: "Persille", waterNeed: "medium", qty: 2 },
    ],
    nextWatering: "06:30",
  },
  {
    id: "b2", name: "Tomat-bed", areaM2: 2.4, sun: "sun", soil: "loam",
    plants: [
      { id: "p4", name: "Tomat", waterNeed: "high", qty: 5 },
      { id: "p5", name: "Basilikum", waterNeed: "medium", qty: 2 },
    ],
    nextWatering: "07:00",
  },
  {
    id: "b3", name: "Salat-bed", areaM2: 1.8, sun: "part", soil: "loam",
    plants: [
      { id: "p6", name: "Salat", waterNeed: "medium", qty: 6 },
      { id: "p7", name: "Spinat", waterNeed: "medium", qty: 4 },
    ],
    nextWatering: "08:00",
  },
];

// Screen-space layout fractions: fx=centerX, fy=centerY, fw=width, fh=height
type LayoutCell = { fx: number; fy: number; fw: number; fh: number };
const LAYOUT: LayoutCell[] = [
  { fx: 0.245, fy: 0.415, fw: 0.275, fh: 0.235 }, // 0 left-back
  { fx: 0.665, fy: 0.37, fw: 0.265, fh: 0.225 }, //  1 right-back
  { fx: 0.46, fy: 0.635, fw: 0.32, fh: 0.255 }, //   2 front-center
];

// Parametric plant positions on bed surface (u,v) in [0,1]²
const PP = [
  { u: 0.18, v: 0.28 }, { u: 0.5, v: 0.18 }, { u: 0.82, v: 0.28 },
  { u: 0.18, v: 0.58 }, { u: 0.5, v: 0.5 }, { u: 0.82, v: 0.58 },
  { u: 0.32, v: 0.78 }, { u: 0.68, v: 0.78 }, { u: 0.5, v: 0.38 },
];

type Pt = { x: number; y: number };
type BedPts = { cx: number; cy: number; w: number; h: number; T: Pt; R: Pt; B: Pt; L: Pt };

function iOffFor(idx: number, intro: number, reduced: boolean): number {
  if (reduced) return 0;
  const delay = idx * 0.19;
  const p = Math.max(0, Math.min(1, (intro - delay) / 0.62));
  const e = 1 - Math.pow(1 - p, 3);
  return (1 - e) * 68;
}

function bedPts(W: number, H: number, li: LayoutCell, lifted: boolean, iOff: number, mx: number, my: number): BedPts {
  const ox = (mx - 0.5) * 15;
  const oy = (my - 0.5) * 7;
  const cx = W * li.fx + ox;
  const cy = H * li.fy + oy - (lifted ? 11 : 0) - (iOff || 0);
  const w = W * li.fw;
  const h = H * li.fh;
  return {
    cx, cy, w, h,
    T: { x: cx, y: cy - h / 2 },
    R: { x: cx + w / 2, y: cy },
    B: { x: cx, y: cy + h / 2 },
    L: { x: cx - w / 2, y: cy },
  };
}

// Bilinear point on bed top face: P(u,v) = T + u*(R-T) + v*(L-T)
function bp(T: Pt, R: Pt, L: Pt, u: number, v: number): Pt {
  return {
    x: T.x + u * (R.x - T.x) + v * (L.x - T.x),
    y: T.y + u * (R.y - T.y) + v * (L.y - T.y),
  };
}

function drawBg(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, "#F6EFE0");
  g.addColorStop(1, "#EDE1CC");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W * 0.46, H * 0.8, 10, W * 0.46, H * 0.8, W * 0.58);
  vg.addColorStop(0, "rgba(68,40,14,0.09)");
  vg.addColorStop(1, "rgba(68,40,14,0)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#6A4A20";
  for (let k = 0; k < 32; k++) {
    const gx = (((k * 173 + 47) % 1000) / 1000) * W;
    const gy = (((k * 239 + 91) % 1000) / 1000) * H;
    ctx.beginPath();
    ctx.arc(gx, gy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlantIcon(ctx: CanvasRenderingContext2D, x: number, y: number, type: IconType, detailed: boolean, t: number) {
  const sw = Math.sin(t * 1.55 + x * 0.058) * 1.9;
  ctx.save();
  if (type === "tomato") {
    ctx.strokeStyle = "#527830"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sw * 0.38, y - 15 + sw * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + sw * 0.2, y - 9, 3.5, 0, Math.PI * 2); ctx.fillStyle = "#4A7A28"; ctx.fill();
    ctx.beginPath(); ctx.arc(x + sw * 0.38, y - 16, 5.5, 0, Math.PI * 2); ctx.fillStyle = "#C83E2A"; ctx.fill();
    ctx.beginPath(); ctx.arc(x + sw * 0.38 - 1.8, y - 17.8, 1.8, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,220,200,0.55)"; ctx.fill();
    if (detailed) { ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x + sw * 0.38, y - 16, 5.5, 0, Math.PI * 2); ctx.stroke(); }
  } else if (type === "salat") {
    ctx.save();
    ctx.translate(x, y + sw * 0.22);
    ctx.scale(1, 0.48);
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fillStyle = "#3B8A2C"; ctx.fill();
    ctx.beginPath(); ctx.arc(-1.5, -2, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(120,200,80,0.35)"; ctx.fill();
    if (detailed) { ctx.strokeStyle = "#2A6820"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  } else {
    const sx = sw * 0.38, sy = sw * 0.18;
    ctx.strokeStyle = "#3C6825"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx, y - 12 + sy); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + sx, y - 13, 4.8, 0, Math.PI * 2); ctx.fillStyle = "#4E7A30"; ctx.fill();
    ctx.beginPath(); ctx.arc(x + sx - 4.5, y - 11, 3.2, 0, Math.PI * 2); ctx.fillStyle = "#3C6A22"; ctx.fill();
    ctx.beginPath(); ctx.arc(x + sx + 4.5, y - 11, 3.2, 0, Math.PI * 2); ctx.fillStyle = "#64963C"; ctx.fill();
    if (detailed) {
      ctx.strokeStyle = "rgba(30,60,15,0.25)"; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x + sx, y - 8); ctx.lineTo(x + sx, y - 17); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPlants(ctx: CanvasRenderingContext2D, T: Pt, R: Pt, L: Pt, bed: CompanionGarden3DBed, detailed: boolean, t: number) {
  let pi = 0;
  bed.plants.forEach((plant) => {
    const n = Math.min(plant.qty, detailed ? 4 : 2);
    const type = plantIconType(plant.name);
    for (let q = 0; q < n; q++) {
      const pos = PP[(pi + q) % PP.length];
      const jx = (((q * 17) % 7) - 3) * 1.7;
      const jy = (((q * 23) % 5) - 2) * 1.1;
      const p = bp(T, R, L, pos.u, pos.v);
      drawPlantIcon(ctx, p.x + jx, p.y + jy, type, detailed, t);
    }
    pi += Math.min(plant.qty, 3);
  });
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, txt: string, sel: boolean) {
  ctx.save();
  const weight = sel ? "700" : "500";
  ctx.font = `${weight} 12px -apple-system,system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  if (sel) {
    const tw = ctx.measureText(txt).width;
    const p = 8, r = 5;
    const rx = x - tw / 2 - p, ry = y - 17, rw = tw + p * 2, rh = 17;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.moveTo(rx + r, ry);
    ctx.lineTo(rx + rw - r, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + r, r);
    ctx.lineTo(rx + rw, ry + rh - r);
    ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
    ctx.lineTo(rx + r, ry + rh);
    ctx.arcTo(rx, ry + rh, rx, ry + rh - r, r);
    ctx.lineTo(rx, ry + r);
    ctx.arcTo(rx, ry, rx + r, ry, r);
    ctx.closePath();
    ctx.shadowColor = "rgba(0,0,0,0.10)";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = sel ? "#173A10" : "rgba(45,30,12,0.62)";
  ctx.fillText(txt, x, y);
  ctx.restore();
}

function drawBed(
  ctx: CanvasRenderingContext2D, W: number, H: number, idx: number,
  sel: boolean, hov: boolean, mode: CompanionGarden3DMode,
  beds: CompanionGarden3DBed[], t: number, intro: number, mx: number, my: number, reduced: boolean,
) {
  const li = LAYOUT[idx];
  const iOff = iOffFor(idx, intro, reduced);
  const { cx, cy, T, R, B, L, w, h } = bedPts(W, H, li, sel, iOff, mx, my);
  const bh = 25;
  const al = Math.max(0, 1 - iOff / 80);

  ctx.save();
  ctx.globalAlpha = al;

  // Ellipse contact shadow
  const sg = ctx.createRadialGradient(cx, cy + h / 2 + bh + 5, 2, cx, cy + h / 2 + bh + 5, w * 0.56);
  sg.addColorStop(0, "rgba(48,26,8,0.17)");
  sg.addColorStop(1, "rgba(48,26,8,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(cx, cy + h / 2 + bh + 5, w * 0.52, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // Right side face
  ctx.beginPath();
  ctx.moveTo(R.x, R.y); ctx.lineTo(B.x, B.y);
  ctx.lineTo(B.x, B.y + bh); ctx.lineTo(R.x, R.y + bh);
  ctx.closePath();
  ctx.fillStyle = "#6A4724";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.07)"; ctx.lineWidth = 0.8;
  [1, 2].forEach((k) => {
    const f = k / 3;
    ctx.beginPath();
    ctx.moveTo(R.x + (B.x - R.x) * f, R.y + (B.y - R.y) * f);
    ctx.lineTo(R.x + (B.x - R.x) * f, R.y + (B.y - R.y) * f + bh);
    ctx.stroke();
  });

  // Left side face
  ctx.beginPath();
  ctx.moveTo(B.x, B.y); ctx.lineTo(L.x, L.y);
  ctx.lineTo(L.x, L.y + bh); ctx.lineTo(B.x, B.y + bh);
  ctx.closePath();
  ctx.fillStyle = "#7C5433";
  ctx.fill();
  [1, 2].forEach((k) => {
    const f = k / 3;
    ctx.beginPath();
    ctx.moveTo(B.x + (L.x - B.x) * f, B.y + (L.y - B.y) * f);
    ctx.lineTo(B.x + (L.x - B.x) * f, B.y + (L.y - B.y) * f + bh);
    ctx.stroke();
  });

  // Wood rim highlight
  ctx.strokeStyle = "rgba(200,160,100,0.18)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(R.x, R.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(L.x, L.y); ctx.stroke();

  // Top soil face
  ctx.beginPath();
  ctx.moveTo(T.x, T.y); ctx.lineTo(R.x, R.y); ctx.lineTo(B.x, B.y); ctx.lineTo(L.x, L.y);
  ctx.closePath();
  const sg2 = ctx.createLinearGradient(T.x, T.y, B.x, B.y);
  sg2.addColorStop(0, "#3A2416");
  sg2.addColorStop(0.45, "#51311E");
  sg2.addColorStop(1, "#3A2416");
  ctx.fillStyle = sg2;
  ctx.fill();

  // Soil texture dots (clipped to top face)
  ctx.save();
  ctx.clip();
  for (let k = 0; k < 16; k++) {
    const u = ((k * 137 + 23) % 100) / 100;
    const v = ((k * 97 + 41) % 100) / 100;
    const p = bp(T, R, L, u * 0.82 + 0.09, v * 0.82 + 0.09);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.15, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(105,62,32,0.32)";
    ctx.fill();
  }
  ctx.restore();

  // Plants
  if (mode !== "water") drawPlants(ctx, T, R, L, beds[idx], mode === "plants", t);

  // Selection / hover border
  if (sel || hov) {
    ctx.beginPath();
    ctx.moveTo(T.x, T.y); ctx.lineTo(R.x, R.y); ctx.lineTo(B.x, B.y); ctx.lineTo(L.x, L.y);
    ctx.closePath();
    ctx.strokeStyle = sel ? "#3AAD5C" : "rgba(58,173,92,0.5)";
    ctx.lineWidth = sel ? 2.5 : 1.5;
    if (sel) { ctx.shadowColor = "#3AAD5C"; ctx.shadowBlur = 18; }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  drawLabel(ctx, T.x, T.y - 7, beds[idx].name, sel);
}

function drawWater(ctx: CanvasRenderingContext2D, W: number, H: number, selIdx: number, t: number, intro: number, mx: number, my: number, reduced: boolean) {
  const li = LAYOUT[selIdx];
  const iOff = intro < 1 ? iOffFor(selIdx, intro, reduced) : 0;
  const { cx, cy, T, w, h } = bedPts(W, H, li, true, iOff, mx, my);

  const sx = W * 0.075, sy = H * 0.165;

  // Animated dashed route bezier
  ctx.save();
  ctx.setLineDash([8, 5]);
  ctx.lineDashOffset = -(t * 24);
  ctx.strokeStyle = "rgba(74,173,232,0.62)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx + (cx - sx) * 0.28, sy, cx, T.y - h * 0.22, cx, T.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Source spigot
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.fillStyle = "rgba(74,173,232,0.12)"; ctx.fill();
  ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fillStyle = "#4AADE8"; ctx.fill();
  ctx.beginPath(); ctx.arc(sx - 2.2, sy - 2.2, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.68)"; ctx.fill();
  const pr = (t * 0.9) % 1;
  ctx.globalAlpha = (1 - pr) * 0.5;
  ctx.beginPath(); ctx.arc(sx, sy, 14 + pr * 12, 0, Math.PI * 2); ctx.strokeStyle = "#4AADE8"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Moisture rings (isometric ellipses)
  for (let k = 0; k < 3; k++) {
    const phase = (t * 0.72 + k * 0.34) % 1;
    const rr = 14 + phase * w * 0.46;
    ctx.save();
    ctx.globalAlpha = (1 - phase) * 0.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr * 0.41, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#4AADE8";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // Falling droplets
  for (let k = 0; k < 8; k++) {
    const phase = (t * 1.35 + k / 8) % 1;
    const dx = cx + (((k * 41 + 7) % 72) - 36) * (w / 148);
    const startY = T.y - 10;
    const dy = startY + phase * (cy - startY);
    const al = phase < 0.78 ? 1 : (1 - phase) * 4.5;
    ctx.save();
    ctx.globalAlpha = al * 0.84;
    ctx.beginPath(); ctx.arc(dx, dy, 2.6, 0, Math.PI * 2); ctx.fillStyle = "#4AADE8"; ctx.fill();
    ctx.beginPath(); ctx.arc(dx - 0.9, dy - 0.9, 1.1, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.fill();
    ctx.restore();
  }

  // Glowing halo on top face
  const hgl = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.38);
  hgl.addColorStop(0, "rgba(74,173,232,0.14)");
  hgl.addColorStop(1, "rgba(74,173,232,0)");
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.38, w * 0.17, 0, 0, Math.PI * 2);
  ctx.fillStyle = hgl;
  ctx.fill();
  ctx.restore();
}

// Point-in-bed-silhouette hit test
function hitBed(px: number, py: number, W: number, H: number, idx: number, sel: number, mx: number, my: number): boolean {
  const { T, R, B, L } = bedPts(W, H, LAYOUT[idx], idx === sel, 0, mx, my);
  const bh = 25;
  const poly: Pt[] = [T, R, { x: R.x, y: R.y + bh }, { x: B.x, y: B.y + bh }, { x: L.x, y: L.y + bh }, L];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function CompanionGarden3DSkeleton() {
  return <div className="companion-3d-skeleton" aria-hidden="true" />;
}

export default function CompanionGarden3D({ beds: bedsProp, selectedBedId, mode: modeProp, onSelectBed, onModeChange }: CompanionGarden3DProps) {
  const beds = useMemo(() => (bedsProp && bedsProp.length ? bedsProp : DEMO_BEDS), [bedsProp]);

  const [mode, setMode] = useState<CompanionGarden3DMode>(modeProp ?? "beds");
  const [sel, setSel] = useState<number>(() => {
    if (selectedBedId) {
      const i = beds.findIndex((b) => b.id === selectedBedId);
      if (i >= 0) return i;
    }
    return 0;
  });
  const [failed, setFailed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  const selRef = useRef(sel);
  const hovRef = useRef(-1);
  const mxRef = useRef(0.5);
  const myRef = useRef(0.5);
  const tRef = useRef(0);
  const introRef = useRef(0);
  const reducedRef = useRef(false);
  const bedsRef = useRef(beds);
  const cbRef = useRef({ onSelectBed, onModeChange });
  const drawRef = useRef<() => void>(() => {});

  bedsRef.current = beds;
  cbRef.current = { onSelectBed, onModeChange };

  // Keep selection in range when the bed set changes.
  useEffect(() => {
    if (sel > beds.length - 1) {
      setSel(0);
      selRef.current = 0;
    }
  }, [beds, sel]);

  // External prop sync
  useEffect(() => {
    if (modeProp && modeProp !== modeRef.current) {
      setMode(modeProp);
      modeRef.current = modeProp;
    }
  }, [modeProp]);

  useEffect(() => {
    if (selectedBedId) {
      const i = bedsRef.current.findIndex((b) => b.id === selectedBedId);
      if (i >= 0 && i !== selRef.current) {
        setSel(i);
        selRef.current = i;
      }
    }
  }, [selectedBedId]);

  const changeMode = (m: CompanionGarden3DMode) => {
    setMode(m);
    modeRef.current = m;
    cbRef.current.onModeChange?.(m);
    drawRef.current();
  };

  // Canvas setup, animation loop and interaction — runs once.
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) {
      setFailed(true);
      return;
    }

    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedRef.current) introRef.current = 1;

    const draw = () => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = c.offsetWidth || c.clientWidth || 900;
      const H = c.offsetHeight || c.clientHeight || 440;
      if (W < 4 || H < 4) return;
      const pw = Math.round(W * dpr);
      const ph = Math.round(H * dpr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = modeRef.current;
      const s = selRef.current;
      const hv = hovRef.current;
      const t = tRef.current;
      const intro = introRef.current;
      const mx = mxRef.current;
      const my = myRef.current;
      const reduced = reducedRef.current;
      const bds = bedsRef.current;
      drawBg(g, W, H);
      [1, 0, 2].forEach((i) => {
        if (i < bds.length) drawBed(g, W, H, i, i === s, i === hv, m, bds, t, intro, mx, my, reduced);
      });
      if (m === "water" && s < bds.length) drawWater(g, W, H, s, t, intro, mx, my, reduced);
    };
    drawRef.current = draw;

    const bedCount = () => bedsRef.current.length;

    const onClick = (e: MouseEvent) => {
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      for (let i = 0; i < bedCount(); i++) {
        if (hitBed(x, y, r.width, r.height, i, selRef.current, mxRef.current, myRef.current)) {
          setSel(i);
          selRef.current = i;
          cbRef.current.onSelectBed?.(bedsRef.current[i].id);
          draw();
          return;
        }
      }
    };

    const onHover = (e: MouseEvent) => {
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (!reducedRef.current) {
        mxRef.current = x / r.width;
        myRef.current = y / r.height;
      }
      let found = -1;
      for (let i = 0; i < bedCount(); i++) {
        if (hitBed(x, y, r.width, r.height, i, selRef.current, mxRef.current, myRef.current)) { found = i; break; }
      }
      if (found !== hovRef.current) {
        hovRef.current = found;
        c.style.cursor = found >= 0 ? "pointer" : "default";
      }
      if (reducedRef.current) draw();
    };

    const onLeave = () => {
      mxRef.current = 0.5;
      myRef.current = 0.5;
      hovRef.current = -1;
      if (reducedRef.current) draw();
    };

    const onTouch = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const x = touch.clientX - r.left, y = touch.clientY - r.top;
      for (let i = 0; i < bedCount(); i++) {
        if (hitBed(x, y, r.width, r.height, i, selRef.current, mxRef.current, myRef.current)) {
          e.preventDefault();
          setSel(i);
          selRef.current = i;
          cbRef.current.onSelectBed?.(bedsRef.current[i].id);
          draw();
          return;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || reducedRef.current) return;
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      mxRef.current = (touch.clientX - r.left) / r.width;
      myRef.current = (touch.clientY - r.top) / r.height;
    };

    cvs.addEventListener("click", onClick);
    cvs.addEventListener("mousemove", onHover);
    cvs.addEventListener("mouseleave", onLeave);
    cvs.addEventListener("touchstart", onTouch, { passive: false });
    cvs.addEventListener("touchmove", onTouchMove, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => draw());
      ro.observe(cvs);
    }

    draw();

    let raf = 0;
    if (!reducedRef.current) {
      const tick = () => {
        tRef.current += 0.018;
        introRef.current = Math.min(1, introRef.current + 0.016);
        draw();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      cvs.removeEventListener("click", onClick);
      cvs.removeEventListener("mousemove", onHover);
      cvs.removeEventListener("mouseleave", onLeave);
      cvs.removeEventListener("touchstart", onTouch);
      cvs.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const bed = beds[Math.min(sel, beds.length - 1)] || beds[0];
  const infoPlants = mode === "plants" ? bed.plants.slice(0, 4) : [];
  const waterStatus = bed.nextWatering
    ? `Næste vanding: ${bed.nextWatering} · AI justerer for regn`
    : "Ingen vanding planlagt · tilføj en timer";

  if (failed) {
    return (
      <div className="companion-3d companion-3d-fallback" role="group" aria-label="Havekompagnon have">
        <h3>Din have</h3>
        <div className="companion-3d-tabs" style={{ position: "static", transform: "none", margin: "0 auto" }} role="tablist" aria-label="Visningsmode">
          {(["beds", "plants", "water"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`companion-3d-tab${mode === m ? " is-active" : ""}`}
              onClick={() => changeMode(m)}
            >
              {m === "beds" ? "Bede" : m === "plants" ? "Planter" : "Vanding"}
            </button>
          ))}
        </div>
        <div className="companion-3d-fallback-beds">
          {beds.map((b, i) => (
            <button
              key={b.id}
              type="button"
              className={`companion-3d-fallback-bed${i === sel ? " is-active" : ""}`}
              onClick={() => { setSel(i); selRef.current = i; cbRef.current.onSelectBed?.(b.id); }}
            >
              <strong>{b.name}</strong>
              <small>{b.areaM2} m² · {SUN_LABEL[b.sun] ?? b.sun} · {SOIL_LABEL[b.soil] ?? b.soil}</small>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="companion-3d">
      <canvas ref={canvasRef} className="companion-3d-canvas" aria-label="3D haven med bede, planter og vanding" />

      <div className="companion-3d-badge">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1C7 1 2 4.5 2 8.2C2 10.9 4.2 13 7 13C9.8 13 12 10.9 12 8.2C12 4.5 7 1 7 1Z" fill="#3D8A30" />
          <line x1="7" y1="13" x2="7" y2="6.5" stroke="#2A6820" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span>Havekompagnon</span>
      </div>

      <div className="companion-3d-tabs" role="tablist" aria-label="Visningsmode">
        <button type="button" role="tab" aria-selected={mode === "beds"} aria-label="Vis bede" className={`companion-3d-tab${mode === "beds" ? " is-active" : ""}`} onClick={() => changeMode("beds")}>Bede</button>
        <button type="button" role="tab" aria-selected={mode === "plants"} aria-label="Vis planter" className={`companion-3d-tab${mode === "plants" ? " is-active" : ""}`} onClick={() => changeMode("plants")}>Planter</button>
        <button type="button" role="tab" aria-selected={mode === "water"} aria-label="Vis vanding" className={`companion-3d-tab${mode === "water" ? " is-active" : ""}`} onClick={() => changeMode("water")}>Vanding</button>
      </div>

      <div className="companion-3d-infobar" aria-live="polite" aria-atomic="true">
        {mode === "beds" && (
          <div className="companion-3d-row">
            <span className="companion-3d-bedname">{bed.name}</span>
            <span className="companion-3d-pill">{bed.areaM2} m²</span>
            <span className="companion-3d-meta">Sol: <strong>{SUN_LABEL[bed.sun] ?? bed.sun}</strong></span>
            <span className="companion-3d-meta">Jord: <strong>{SOIL_LABEL[bed.soil] ?? bed.soil}</strong></span>
          </div>
        )}

        {mode === "plants" && (
          <div className="companion-3d-row companion-3d-row--plants">
            <span className="companion-3d-bedname">{bed.name}</span>
            {infoPlants.length === 0 && <span className="companion-3d-meta">Ingen planter endnu</span>}
            {infoPlants.map((p) => (
              <span key={p.id} className="companion-3d-plantchip">
                <b>{p.name}</b>
                <span>Vandbehov: {WATER_LABEL[p.waterNeed] ?? p.waterNeed}</span>
              </span>
            ))}
          </div>
        )}

        {mode === "water" && (
          <div className="companion-3d-waterrow">
            <div className="companion-3d-waterdot" />
            <span className="companion-3d-waterstatus">{waterStatus}</span>
          </div>
        )}
      </div>
    </div>
  );
}
