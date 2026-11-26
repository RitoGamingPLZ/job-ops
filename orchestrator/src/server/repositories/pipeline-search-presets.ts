import { randomUUID } from "node:crypto";
import type {
  CreatePipelineSearchPresetInput,
  PipelineSearchPreset,
  PipelineSearchPresetConfig,
  UpdatePipelineSearchPresetInput,
} from "@shared/types";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getRequiredUserScope, requiredUserScopeFilter } from "../tenancy/private-scope";

const { pipelineSearchPresets } = schema;

const PRESET_USER_CONTEXT_ERROR = "User context is required for pipeline saved searches";

function presetsScopeFilter() {
  return requiredUserScopeFilter(pipelineSearchPresets, PRESET_USER_CONTEXT_ERROR);
}

function mapRowToSearchPreset(
  row: typeof pipelineSearchPresets.$inferSelect,
): PipelineSearchPreset {
  return {
    id: row.id,
    name: row.name,
    config: row.config as PipelineSearchPresetConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function listPipelineSearchPresets(): Promise<PipelineSearchPreset[]> {
  const rows = await db
    .select()
    .from(pipelineSearchPresets)
    .where(presetsScopeFilter())
    .orderBy(desc(pipelineSearchPresets.lastUsedAt), desc(pipelineSearchPresets.updatedAt));

  return rows.map(mapRowToSearchPreset);
}

export async function createPipelineSearchPreset(
  input: CreatePipelineSearchPresetInput,
): Promise<PipelineSearchPreset> {
  const { tenantId, userId } = getRequiredUserScope(PRESET_USER_CONTEXT_ERROR);
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(pipelineSearchPresets).values({
    id,
    tenantId,
    userId,
    name: input.name,
    config: input.config,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  });

  const preset = await getPipelineSearchPreset(id);
  if (!preset) {
    throw new Error("Failed to retrieve created pipeline saved search");
  }
  return preset;
}

export async function updatePipelineSearchPreset(
  id: string,
  input: UpdatePipelineSearchPresetInput,
): Promise<PipelineSearchPreset | null> {
  const existing = await getPipelineSearchPreset(id);
  if (!existing) return null;

  await db
    .update(pipelineSearchPresets)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(and(presetsScopeFilter(), eq(pipelineSearchPresets.id, id)));

  return getPipelineSearchPreset(id);
}

export async function markPipelineSearchPresetUsed(
  id: string,
): Promise<PipelineSearchPreset | null> {
  const existing = await getPipelineSearchPreset(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  await db
    .update(pipelineSearchPresets)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(and(presetsScopeFilter(), eq(pipelineSearchPresets.id, id)));

  return getPipelineSearchPreset(id);
}

export async function deletePipelineSearchPreset(id: string): Promise<number> {
  const result = await db
    .delete(pipelineSearchPresets)
    .where(and(presetsScopeFilter(), eq(pipelineSearchPresets.id, id)));

  return result.changes;
}

export async function pipelineSearchPresetNameExists(input: {
  name: string;
  excludingId?: string;
}): Promise<boolean> {
  const clauses = [presetsScopeFilter(), eq(pipelineSearchPresets.name, input.name)];
  if (input.excludingId) {
    clauses.push(ne(pipelineSearchPresets.id, input.excludingId));
  }

  const [row] = await db
    .select({ id: pipelineSearchPresets.id })
    .from(pipelineSearchPresets)
    .where(and(...clauses))
    .limit(1);

  return Boolean(row);
}

async function getPipelineSearchPreset(id: string): Promise<PipelineSearchPreset | null> {
  const [row] = await db
    .select()
    .from(pipelineSearchPresets)
    .where(and(presetsScopeFilter(), eq(pipelineSearchPresets.id, id)))
    .limit(1);

  return row ? mapRowToSearchPreset(row) : null;
}
