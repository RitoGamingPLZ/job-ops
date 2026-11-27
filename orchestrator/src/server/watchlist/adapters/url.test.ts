import { describe, expect, it } from "vitest";
import {
  getSourceHost,
  hasPlainHttpsAuthority,
  parseSafeHttpsUrl,
  parseWatchlistUrl,
  tryParseSafeHttpsUrl,
} from "./url";

describe("watchlist url helpers", () => {
  it("validates plain HTTPS authorities, ports, userinfo, and bare IPv6 literals", () => {
    expect(hasPlainHttpsAuthority("https://jobs.example.com/careers")).toBe(true);
    expect(hasPlainHttpsAuthority("https://[::ffff:192.168.0.1]/careers")).toBe(true);
    expect(hasPlainHttpsAuthority("https://jobs.example.com:443/careers")).toBe(false);
    expect(hasPlainHttpsAuthority("https://jobs.example.com:8443/careers")).toBe(false);
    expect(hasPlainHttpsAuthority("https://[::1]:443/careers")).toBe(false);
    expect(hasPlainHttpsAuthority("https://user:pass@jobs.example.com/careers")).toBe(false);
    expect(hasPlainHttpsAuthority("http://jobs.example.com/careers")).toBe(false);
  });

  it("parses safe HTTPS URLs and rejects unsafe schemes, ports, and credentials", () => {
    expect(tryParseSafeHttpsUrl("  https://jobs.example.com/roles?a=1  ")?.href).toBe(
      "https://jobs.example.com/roles?a=1",
    );
    expect(tryParseSafeHttpsUrl("/roles/1", "https://jobs.example.com/jobs")?.href).toBe(
      "https://jobs.example.com/roles/1",
    );
    expect(tryParseSafeHttpsUrl("http://jobs.example.com/")).toBeNull();
    expect(tryParseSafeHttpsUrl("https://user@jobs.example.com/")).toBeNull();
    expect(tryParseSafeHttpsUrl("https://jobs.example.com:443/")).toBeNull();
    expect(tryParseSafeHttpsUrl("not-a-url")).toBeNull();

    expect(() => parseSafeHttpsUrl("https://jobs.example.com:8443/", "Bad URL")).toThrow("Bad URL");
    expect(() => parseWatchlistUrl("not-a-url", "Invalid URL")).toThrow("Invalid URL");
  });

  it("extracts lowercased hostnames safely", () => {
    expect(getSourceHost("https://Jobs.Example.COM/careers")).toBe("jobs.example.com");
    expect(getSourceHost("not-a-url")).toBeNull();
  });
});
