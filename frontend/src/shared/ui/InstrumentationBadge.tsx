import { StatusPill } from "./StatusPill";

type InstrumentationStatus = "live" | "sampled" | "derived" | "not_instrumented" | "proposed";

type InstrumentationBadgeProps = {
  status: InstrumentationStatus;
  className?: string;
};

const statusLabel: Record<InstrumentationStatus, string> = {
  live: "live",
  sampled: "sampled",
  derived: "derived",
  not_instrumented: "not instrumented",
  proposed: "propuesto",
};

const statusTone: Record<InstrumentationStatus, string> = {
  live: "ok",
  sampled: "info",
  derived: "primary",
  not_instrumented: "unknown",
  proposed: "warning",
};

export function InstrumentationBadge({ status, className }: InstrumentationBadgeProps) {
  return <StatusPill status={statusTone[status]} label={statusLabel[status]} className={className} />;
}
