"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CENTER_LABELS, LIMIT_PERIODS, type CostCenter, type CostLimits, type LimitPeriod } from "@/lib/cost-rates";

import { saveCostLimits } from "./actions";

const text = (value: number | null | undefined) => (value ? String(value) : "");
const LABELS: Record<LimitPeriod, string> = { day: "Per day ($)", week: "Per week ($)", month: "Per month ($)" };
type Values = Partial<Record<CostCenter, Record<LimitPeriod, string>>>;

/** A daily, weekly and monthly limit for each paid service in use; empty means no limit. */
export function CostLimitsForm({ centers, limits }: { centers: readonly CostCenter[]; limits: CostLimits }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [values, setValues] = useState<Values>(() => Object.fromEntries(centers.map((center) => [center, Object.fromEntries(LIMIT_PERIODS.map((period) => [period, text(limits[center]?.[period])]))])) as Values);
  const change = (center: CostCenter, period: LimitPeriod, value: string) => setValues((now) => ({ ...now, [center]: { ...now[center]!, [period]: value } }));
  const save = () =>
    startSaving(async () => {
      const amount = (value: string) => (value.trim() && Number(value) > 0 ? Number(value) : null);
      const next = Object.fromEntries(centers.map((center) => [center, Object.fromEntries(LIMIT_PERIODS.map((period) => [period, amount(values[center]?.[period] ?? "")]))]));
      // A service not in use right now keeps the limits it had.
      if (toastResult(await saveCostLimits({ limits: { ...limits, ...next } })).ok) router.refresh();
    });
  if (centers.length === 0) return null;
  return (
    <Card padding="none" className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium">Cost limits</h2>
        <p className="text-meta text-muted">Past a limit, that service stops and Scout tells you. Everything else keeps working. Raising a limit unlocks it as soon as you save. Weeks run Monday to Sunday, and months from the 1st. A batch already out can pass a limit by a little. Leave a box empty for no limit.</p>
      </div>
      {centers.map((center) => (
        <div key={center} className="grid gap-3 sm:grid-cols-[1fr_120px_120px_120px] sm:items-end">
          <span className="text-sm sm:pb-2.5">{CENTER_LABELS[center]}</span>
          {LIMIT_PERIODS.map((period) => (
            <Input key={period} label={LABELS[period]} inputMode="decimal" value={values[center]?.[period] ?? ""} onChange={(event) => change(center, period, event.target.value)} />
          ))}
        </div>
      ))}
      <div className="flex justify-end">
        <Button aria-disabled={saving || undefined} onClick={() => !saving && save()}>
          {saving ? "Saving…" : "Save limits"}
        </Button>
      </div>
    </Card>
  );
}
