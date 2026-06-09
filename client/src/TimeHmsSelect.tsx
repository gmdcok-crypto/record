import { clampHms, msToHms, type HmsTime } from "./quotePricing";

const SELECT_CLASS =
  "rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500";

export default function TimeHmsSelect({
  value,
  onChange,
  maxMs,
  label,
}: {
  value: HmsTime;
  onChange: (next: HmsTime) => void;
  maxMs?: number;
  label: string;
}) {
  const max = maxMs != null ? msToHms(maxMs) : { hour: 23, minute: 59, second: 59 };
  const minuteMax = value.hour === max.hour ? max.minute : 59;
  const secondMax = value.hour === max.hour && value.minute === max.minute ? max.second : 59;

  const update = (patch: Partial<HmsTime>) => {
    onChange(clampHms({ ...value, ...patch }, maxMs));
  };

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={value.hour}
          onChange={(event) => update({ hour: Number(event.target.value) })}
          className={SELECT_CLASS}
        >
          {Array.from({ length: max.hour + 1 }, (_, hour) => (
            <option key={hour} value={hour}>
              {hour}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">시</span>
        <select
          value={value.minute}
          onChange={(event) => update({ minute: Number(event.target.value) })}
          className={SELECT_CLASS}
        >
          {Array.from({ length: minuteMax + 1 }, (_, minute) => (
            <option key={minute} value={minute}>
              {minute}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">분</span>
        <select
          value={value.second}
          onChange={(event) => update({ second: Number(event.target.value) })}
          className={SELECT_CLASS}
        >
          {Array.from({ length: secondMax + 1 }, (_, second) => (
            <option key={second} value={second}>
              {second}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">초</span>
      </div>
    </div>
  );
}
