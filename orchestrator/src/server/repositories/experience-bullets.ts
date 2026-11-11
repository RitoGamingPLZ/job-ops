import { randomUUID } from "node:crypto";
import type { ExperienceBullet, ExperienceBulletInput } from "@shared/types";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const { experienceBullets: table } = schema;
function publicBullet({
  tenantId: _tenant,
  userId: _user,
  ...bullet
}: typeof table.$inferSelect): ExperienceBullet {
  return bullet;
}
export async function listExperienceBullets(
  allKinds = false,
): Promise<ExperienceBullet[]> {
  return db
    .select()
    .from(table)
    .where(
      and(
        privateDataScopeFilter(table),
        allKinds ? undefined : eq(table.kind, "bullet"),
      ),
    )
    .orderBy(asc(table.position), asc(table.createdAt), asc(table.id))
    .all()
    .map(publicBullet);
}
export async function createExperienceBullet(
  input: ExperienceBulletInput,
): Promise<ExperienceBullet> {
  const scope = getPrivateDataScope();
  const now = new Date().toISOString();
  return publicBullet(
    db
      .insert(table)
      .values({
        id: randomUUID(),
        ...scope,
        kind: input.kind ?? "bullet",
        data: input.data ?? null,
        parentId: input.parentId ?? null,
        position: input.position ?? 0,
        text: input.text,
        company: input.company ?? null,
        role: input.role ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        tags: input.tags ?? [],
        source: input.source ?? "manual",
        sourceExperienceId: input.sourceExperienceId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );
}
export async function updateExperienceBullet(
  id: string,
  input: Partial<ExperienceBulletInput>,
): Promise<ExperienceBullet | null> {
  const row = db
    .update(table)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(and(privateDataScopeFilter(table), eq(table.id, id)))
    .returning()
    .get();
  return row ? publicBullet(row) : null;
}
export async function deleteExperienceBullet(id: string): Promise<boolean> {
  return (
    db
      .delete(table)
      .where(and(privateDataScopeFilter(table), eq(table.id, id)))
      .run().changes > 0
  );
}
export function normalizeBulletText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
/** One transaction prevents concurrent imports from duplicating normalized text. */
export async function importExperienceBullets(inputs: ExperienceBulletInput[]) {
  return db.transaction((tx) => {
    const scope = getPrivateDataScope();
    const existing = tx
      .select()
      .from(table)
      .where(and(privateDataScopeFilter(table), eq(table.kind, "bullet")))
      .all();
    const seen = new Set(existing.map((row) => normalizeBulletText(row.text)));
    const bullets: ExperienceBullet[] = [];
    let skipped = 0;
    const now = new Date().toISOString();
    for (const input of inputs) {
      const key = normalizeBulletText(input.text);
      if (!key || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      bullets.push(
        publicBullet(
          tx
            .insert(table)
            .values({
              id: randomUUID(),
              ...scope,
              ...input,
              tags: input.tags ?? [],
              source: input.source ?? "resume",
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        ),
      );
    }
    return { created: bullets.length, skipped, bullets };
  });
}
