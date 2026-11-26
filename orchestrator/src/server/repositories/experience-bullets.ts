import type { ExperienceBullet } from "@shared/types";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { privateDataScopeFilter } from "../tenancy/private-scope";

const { experienceBullets: table } = schema;
function publicBullet({
  tenantId: _tenant,
  userId: _user,
  ...bullet
}: typeof table.$inferSelect): ExperienceBullet {
  return bullet;
}
export async function listExperienceBullets(allKinds = false): Promise<ExperienceBullet[]> {
  return db
    .select()
    .from(table)
    .where(and(privateDataScopeFilter(table), allKinds ? undefined : eq(table.kind, "bullet")))
    .orderBy(asc(table.position), asc(table.createdAt), asc(table.id))
    .all()
    .map(publicBullet);
}
export function normalizeBulletText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}
