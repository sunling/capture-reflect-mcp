import { assertDate } from "./storage/record-utils.js";
import type { RecordsStore } from "./storage/records-store.js";

export async function getBubbleBreakerContext(
  store: RecordsStore,
  range: { from?: string | undefined; to?: string | undefined },
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now = new Date(),
) {
  if ((range.from === undefined) !== (range.to === undefined)) {
    throw new Error("Provide both from and to, or omit both for the last seven days.");
  }
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const start = new Date(`${currentDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const from = range.from ?? start.toISOString().slice(0, 10);
  const to = range.to ?? currentDate;
  assertDate(from);
  assertDate(to);
  if (from > to) throw new Error("from must be on or before to.");
  return {
    currentDate,
    currentTimestamp: now.toISOString(),
    timeZone,
    from,
    to,
    records: await store.getRecords({ from, to, types: ["journal", "note"] }),
  };
}
