import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, Check } from "lucide-react";

const DAYS = ["M", "T", "O", "T", "F", "L", "S"];
function maskLabel(m: number) {
  return DAYS.map((d, i) => (m & (1 << i)) ? d : "·").join("");
}

export type AiPlan = {
  summary: string;
  zones: { zone_id: string; reasoning: string; schedules: { name: string; weekday_mask: number; start_time: string; duration_min: number }[] }[];
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: AiPlan | null;
  zoneNames: Record<string, string>;
  loading: boolean;
  onApply: () => void;
};

export default function AiPlanPreview({ open, onOpenChange, plan, zoneNames, loading, onApply }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-600" /> AI vandingsplan
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="mt-8 text-center">
            <div className="inline-block w-10 h-10 rounded-full border-4 border-foreground/10 border-t-foreground animate-spin" />
            <p className="mt-4 text-sm text-muted-foreground">AI'en analyserer have, vejr og planter…</p>
          </div>
        )}

        {plan && !loading && (
          <div className="mt-4 space-y-4 animate-fade-in">
            <p className="text-sm leading-relaxed p-3 rounded-lg" style={{ background: "rgba(20,120,60,0.06)" }}>
              {plan.summary}
            </p>

            {plan.zones.map((z, i) => (
              <div key={z.zone_id} className="border border-border rounded-xl p-4 animate-fade-in" style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}>
                <div className="font-medium mb-1">{zoneNames[z.zone_id] ?? "Zone"}</div>
                <div className="text-xs text-muted-foreground mb-3">{z.reasoning}</div>
                <div className="space-y-2">
                  {z.schedules.map((s, j) => (
                    <div key={j} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-md bg-muted/40">
                      <span className="font-medium">{s.name}</span>
                      <span className="font-mono text-xs">{maskLabel(s.weekday_mask)}</span>
                      <span className="text-xs">{s.start_time} · {s.duration_min} min</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="sticky bottom-0 bg-background pt-3 pb-1 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Annullér</Button>
              <Button className="flex-1" onClick={onApply}>
                <Check size={16} className="mr-1" /> Anvend plan
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
