import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLocalDayRange, parseLocalDateKey, toLocalDateKey } from "./local-calendar";

describe("local-calendar", () => {
  const previousTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Toronto";
  });

  afterAll(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });

  it("formats and parses local calendar days, not UTC", () => {
    // 23:30 local on Mar 8 is already Mar 9 in UTC.
    const lateEvening = new Date(2026, 2, 8, 23, 30);
    expect(toLocalDateKey(lateEvening)).toBe("2026-03-08");
    const parsed = parseLocalDateKey("2026-03-08");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(8);
    expect(parsed.getHours()).toBe(0);
  });

  it("builds an inclusive range across a DST transition", () => {
    // DST starts 2026-03-08 in Toronto.
    const now = new Date(2026, 2, 10, 12, 0);
    const { start, end } = getLocalDayRange(4, now);
    expect(toLocalDateKey(start)).toBe("2026-03-07");
    expect(start.getHours()).toBe(0);
    expect(toLocalDateKey(end)).toBe("2026-03-10");
    expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59]);
    expect(end.getMilliseconds()).toBe(999);
    expect(now.getHours()).toBe(12);
  });

  it("returns a single-day range for days = 1", () => {
    const { start, end } = getLocalDayRange(1, new Date(2026, 0, 5, 8));
    expect(toLocalDateKey(start)).toBe("2026-01-05");
    expect(toLocalDateKey(end)).toBe("2026-01-05");
  });
});
