"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { CENTER_LABELS, dollars, FREE_CENTERS, JEV_INPUT_RATE, JSEARCH_REQUEST_COST, PRICES_AS_OF, type CostCenter } from "@/lib/cost-rates";
import type { CostPeriod } from "@/lib/costs";

type Period = { id: CostPeriod; label: string };

/** Spending by service in use, for one period at a time. */
export function CostTable({ periods, centers, amounts, tracking }: { periods: readonly Period[]; centers: readonly CostCenter[]; amounts: Record<CostPeriod, Record<CostCenter, number>>; tracking: string }) {
  const [period, setPeriod] = useState<CostPeriod>("month");
  const shown = amounts[period];
  const total = centers.reduce((sum, center) => sum + shown[center], 0);
  return (
    <Card padding="none" className="flex flex-col gap-3 px-6 py-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-medium">By service</h2>
        <Select aria-label="Period" className="w-44" value={period} onChange={(event) => setPeriod(event.target.value as CostPeriod)}>
          {periods.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-meta text-muted">
            <th className="py-2 pr-4 font-medium">Service</th>
            <th className="py-2 pl-4 text-right font-medium">Estimated cost</th>
          </tr>
        </thead>
        <tbody>
          {centers.map((center) => (
            <tr key={center} className="border-t border-line">
              <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                {CENTER_LABELS[center]}
              </th>
              <td className="py-2.5 pl-4 text-right tabular-nums">{FREE_CENTERS.includes(center) ? "Free" : dollars(shown[center])}</td>
            </tr>
          ))}
          <tr className="border-t border-line text-muted">
            <th scope="row" className="py-2.5 pr-4 text-left font-normal">
              Hosting (runs on this computer)
            </th>
            <td className="py-2.5 pl-4 text-right tabular-nums">$0.00</td>
          </tr>
          <tr className="border-t border-line-strong font-medium">
            <th scope="row" className="py-2.5 pr-4 text-left">
              Total
            </th>
            <td className="py-2.5 pl-4 text-right tabular-nums">{dollars(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-meta text-muted">
        Estimates, based on each service&apos;s prices as of {PRICES_AS_OF}. Prices can change, and each service&apos;s own bill has the last word. {tracking} JSearch is counted at ${JSEARCH_REQUEST_COST.toFixed(3)} a request and Jev at ${JEV_INPUT_RATE} per million input tokens. An AI model without a listed price is counted at $1 per million tokens in and $5 out.
      </p>
    </Card>
  );
}
