import type { WeightMeasurement } from "../../../shared/withings/model";

export function WeightReadings({ items }: { items: WeightMeasurement[] }) {
  return <ul className="withings-readings">{items.map((item) => <li key={item.sourceId} className="withings-reading">
    <strong>{item.weightKg.toLocaleString("en-AU", { maximumFractionDigits: 3 })} kg</strong>
    <a href={`#/d/${item.localDate}`}><time dateTime={item.measuredAt}>{new Intl.DateTimeFormat("en-AU", {
      timeZone: item.timezone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
    }).format(new Date(item.measuredAt))}</time></a>
  </li>)}</ul>;
}
