import { useStore } from "../lib/store";
import { PRESETS, type PeriodPreset } from "../lib/period";

export function PeriodPicker() {
  const { period, setPeriod } = useStore();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input w-auto"
        value={period.preset}
        onChange={(e) => setPeriod({ ...period, preset: e.target.value as PeriodPreset })}
        aria-label="Période"
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {period.preset === "custom" && (
        <>
          <input type="date" className="input w-auto" value={period.from ?? ""} onChange={(e) => setPeriod({ ...period, from: e.target.value })} aria-label="Du" />
          <input type="date" className="input w-auto" value={period.to ?? ""} onChange={(e) => setPeriod({ ...period, to: e.target.value })} aria-label="Au" />
        </>
      )}
    </div>
  );
}
