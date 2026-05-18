import { describe, expect, it } from "vitest";
import { actionFromScan, actionsFromBedScan, actionsFromGrowth, generateDeviceActions, generateWeatherActions } from "@/lib/companionActions";
import { clampNormalizedPoint, mapAnchor, normalizeScanResult, readCompanionPreferences } from "@/lib/companionTypes";

describe("companion map anchors", () => {
  it("clamps normalized positions away from unusable edges", () => {
    expect(clampNormalizedPoint(-1, 2)).toEqual({ normalized_x: 0.03, normalized_y: 0.97 });
  });

  it("creates a manual map anchor for garden observations", () => {
    expect(mapAnchor("garden-1", "zone-1", "plant-1", 0.25, 0.75)).toMatchObject({
      garden_id: "garden-1",
      zone_id: "zone-1",
      plant_id: "plant-1",
      normalized_x: 0.25,
      normalized_y: 0.75,
      accuracy: "manual",
    });
  });
});

describe("companion scan normalization", () => {
  it("turns high severity diagnosis into an urgent care action", () => {
    const scan = normalizeScanResult({
      diagnosis: "Meldug i roser",
      severity: "high",
      confidence: 0.82,
      symptoms: ["hvid belægning"],
      causes: ["tæt beplantning"],
      treatment: "Fjern angrebne blade og luft ud i bedet.",
    });

    const action = actionFromScan("garden-1", scan, "obs-1", "zone-1", "plant-1");
    expect(action).toMatchObject({
      kind: "diagnose",
      priority: "urgent",
      source: "scan",
      garden_id: "garden-1",
      observation_id: "obs-1",
    });
  });

  it("does not create tasks for low risk scans", () => {
    const scan = normalizeScanResult({ diagnosis: "Ser sund ud", severity: "low", treatment: "Hold øje." });
    expect(actionFromScan("garden-1", scan, "obs-1")).toBeNull();
  });

  it("turns bed scan task suggestions into mapped care actions", () => {
    const actions = actionsFromBedScan("garden-1", {
      confidence: 0.74,
      task_suggestions: [
        { title: "Lug ukrudt i tomatbedet", priority: "medium", reason: "Bedet er tæt ved kanten." },
      ],
    }, "obs-2", "zone-1");

    expect(actions[0]).toMatchObject({
      kind: "bed_followup",
      priority: "high",
      source: "scan",
      zone_id: "zone-1",
      observation_id: "obs-2",
    });
  });

  it("creates growth actions for anomalies and harvest readiness", () => {
    const actions = actionsFromGrowth("garden-1", {
      confidence: 0.7,
      anomaly_flags: ["gulning"],
      harvest_readiness: "klar",
    }, "obs-3", "zone-1", "plant-1");

    expect(actions.map((action) => action.kind)).toEqual(expect.arrayContaining(["growth_anomaly", "harvest_ready"]));
  });
});

describe("companion deterministic suggestions", () => {
  it("creates heat watch actions for sunny zones during heat streaks", () => {
    const actions = generateWeatherActions(
      "garden-1",
      [{ id: "z1", name: "Tomatbed", sun_exposure: "sun" }],
      [
        { date: "2026-07-01", precip_mm: 0, temp_max: 29, temp_min: 15, et0: 4 },
        { date: "2026-07-02", precip_mm: 0, temp_max: 30, temp_min: 16, et0: 4 },
        { date: "2026-07-03", precip_mm: 0, temp_max: 24, temp_min: 14, et0: 3 },
      ],
    );
    expect(actions.some((a) => a.kind === "heat_watch" && a.zone_id === "z1")).toBe(true);
  });

  it("creates sensor dry and battery actions from device readings", () => {
    const actions = generateDeviceActions("garden-1", [
      { id: "d1", name: "Sensor 1", kind: "sensor", status: "online", battery: 18, metadata: { zone_id: "z1", moisture_pct: 22 } },
    ]);
    expect(actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["device_battery", "sensor_dry"]));
  });
});

describe("companion preferences", () => {
  it("normalizes automation and onboarding preferences", () => {
    expect(readCompanionPreferences({
      goals: ["Høst"],
      weekly_time_budget_minutes: 999,
      automation_mode: "device_autopilot",
      notification_preference: "urgent",
      device_autopilot_confirmed: true,
    })).toMatchObject({
      goals: ["Høst"],
      weekly_time_budget_minutes: 720,
      automation_mode: "device_autopilot",
      notification_preference: "urgent",
      device_autopilot_confirmed: true,
    });
  });
});
