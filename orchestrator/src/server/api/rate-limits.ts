import { clientIp, createRateLimiter } from "@infra/rate-limit";

const MINUTE = 60_000;

function loginUsername(req: { body?: unknown }): string {
  const body = req.body as { username?: unknown } | undefined;
  return typeof body?.username === "string" ? body.username.trim().toLowerCase().slice(0, 200) : "";
}

/** Brute-force protection: per client address and per target account. */
export const loginIpLimiter = createRateLimiter({
  name: "login-ip",
  windowMs: 15 * MINUTE,
  max: 30,
  methods: ["POST"],
  key: (req) => `ip:${clientIp(req)}`,
});

export const loginAccountLimiter = createRateLimiter({
  name: "login-account",
  windowMs: 15 * MINUTE,
  max: 10,
  methods: ["POST"],
  key: (req) => `account:${loginUsername(req)}`,
});

/** Starting a search spins up scrapers and external API calls. */
export const pipelineRunLimiter = createRateLimiter({
  name: "pipeline-run",
  windowMs: 60 * MINUTE,
  max: 10,
  methods: ["POST"],
});

/** Server-side fetches of user-supplied pages and upstream catalog calls. */
export const outboundFetchLimiter = createRateLimiter({
  name: "outbound-fetch",
  windowMs: 10 * MINUTE,
  max: 60,
  methods: ["POST"],
});

/** LLM-backed or document-rendering actions. */
export const heavyActionLimiter = createRateLimiter({
  name: "heavy-action",
  windowMs: 10 * MINUTE,
  max: 60,
  methods: ["POST"],
});

/** Credential and endpoint probes against third-party providers. */
export const validationLimiter = createRateLimiter({
  name: "validation",
  windowMs: 10 * MINUTE,
  max: 30,
  methods: ["POST"],
});

/** Invitation links are bearer secrets: slow down anyone probing for valid ones. */
export const invitationLimiter = createRateLimiter({
  name: "invitation",
  windowMs: 15 * MINUTE,
  max: 30,
  key: (req) => `ip:${clientIp(req)}`,
});
