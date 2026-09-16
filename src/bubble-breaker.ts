import { resolveDateRange } from "./date-range.js";
import type { RecordsStore } from "./storage/records-store.js";

export async function getBubbleBreakerContext(
  store: RecordsStore,
  range: { from?: string | undefined; to?: string | undefined },
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now = new Date(),
) {
  const { currentDate, from, to } = resolveDateRange(range, timeZone, now);
  return {
    currentDate,
    currentTimestamp: now.toISOString(),
    timeZone,
    from,
    to,
    records: await store.getRecords({ from, to, types: ["journal", "note"] }),
  };
}
