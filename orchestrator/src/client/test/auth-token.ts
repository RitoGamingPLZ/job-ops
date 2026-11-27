export function makeAuthToken(tenantId: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [encode({ alg: "HS256", typ: "JWT" }), encode({ tenantId }), "signature"].join(".");
}
