import * as api from "@client/api/cowork";
import {
  addToResume,
  applyLibraryUpdate,
  getItemLines,
  isOnResume,
  KIND_SECTION,
  removeFromResume,
  sameLineText,
} from "@shared/resume-links";
import type {
  CandidateItemKind,
  ExperienceBullet,
  ExperienceBulletInput,
  LibraryItemUsage,
  RankedBullet,
  ReactiveResumeV5Document,
} from "@shared/types";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { coworkError, DutyLibraryTools, InlineTags } from "./DutyLibrary";
import { BULLET_TRANSFER_TYPE } from "./editor";
import { REWORDED_TINT_CLASS } from "./rewordTint";

const sections = [
  ["role", "Experience"],
  ["project", "Projects"],
  ["skill", "Skills"],
  ["education", "Education"],
  ["award", "Awards"],
  ["certification", "Certifications"],
] as const;
const names: Record<CandidateItemKind, string> = {
  role: "role",
  bullet: "duty",
  project: "project",
  project_point: "point",
  skill: "skill group",
  education: "education",
  award: "award",
  certification: "certification",
};
const fields: Partial<Record<CandidateItemKind, string[]>> = {
  role: ["period"],
  project: ["period", "website"],
  education: ["school", "location", "period"],
  award: ["date"],
  certification: ["issuer", "website", "date"],
};
const fieldNames: Record<string, string> = {
  company: "Company",
  location: "Location",
  website: "Website",
  period: "Period",
  school: "School",
  issuer: "Issuer",
  date: "Date",
};
type Doc = ReactiveResumeV5Document;
type Item = ExperienceBullet;
type Edit = {
  items: Item[];
  input: ExperienceBulletInput;
  fields: string[];
  companyOnly?: boolean;
  addCompany?: string;
};
const keywords = (item: Item): string[] =>
  Array.isArray(item.data?.keywords)
    ? item.data.keywords.filter((v): v is string => typeof v === "string")
    : [];
function resumeItems(
  document?: Doc,
  sectionName?: string,
): Record<string, unknown>[] {
  const sections = document?.sections as
    | Record<string, { items?: Record<string, unknown>[] }>
    | undefined;
  const values = sectionName
    ? [sections?.[sectionName]]
    : Object.values(sections ?? {});
  return values.flatMap((section) => section?.items ?? []);
}

export function CandidateLibrary({
  jobId,
  frozen = false,
  document,
  onDocumentChange,
  onReferenceBullet,
}: {
  jobId?: string;
  frozen?: boolean;
  document?: Doc;
  onDocumentChange?: (update: (doc: Doc) => Doc) => void;
  onReferenceBullet?: (bullet: ExperienceBullet) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [section, setSection] = useState<CandidateItemKind>("role");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [ranked, setRanked] = useState<RankedBullet[]>([]);
  const [deletion, setDeletion] = useState<{
    items: Item[];
    usage: LibraryItemUsage;
  } | null>(null);
  const refresh = useCallback(async () => {
    setItems((await api.listCandidateLibrary()).items);
    setFailed(false);
  }, []);
  useEffect(() => {
    let active = true;
    api
      .listCandidateLibrary()
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((error) => {
        if (active) {
          setFailed(true);
          coworkError(error);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      coworkError(error);
    } finally {
      setBusy(false);
    }
  }
  async function update(before: Item, input: Partial<ExperienceBulletInput>) {
    const after = (await api.updateExperienceBullet(before.id, input, jobId))
      .bullet;
    setItems((current) =>
      current.map((item) => (item.id === after.id ? after : item)),
    );
    if (input.text !== undefined || input.data !== undefined) setRanked([]);
    if (!frozen)
      onDocumentChange?.((doc) => applyLibraryUpdate(doc, before, after));
    return after;
  }
  function toggle(group: Item[], checked: boolean) {
    onDocumentChange?.((doc) =>
      group.reduce(
        (next, item) =>
          checked
            ? addToResume(next, item.id, items)
            : removeFromResume(next, item.id),
        doc,
      ),
    );
  }
  function tick(group: Item[], label: string) {
    if (!jobId) return null;
    const count = group.filter(
      (item) => document && isOnResume(document, item.id),
    ).length;
    return (
      <Checkbox
        aria-label={`Include ${label}`}
        disabled={busy || !document || !onDocumentChange}
        checked={
          count === group.length ? true : count ? "indeterminate" : false
        }
        onCheckedChange={(checked) => toggle(group, checked === true)}
      />
    );
  }
  function startEdit(item: Item) {
    setEdit({
      items: [item],
      input: {
        text: item.text,
        kind: item.kind,
        data: item.data ? { ...item.data } : null,
      },
      fields: fields[item.kind] ?? [],
    });
  }
  function startAdd(
    kind: CandidateItemKind,
    parentId?: string,
    companyData?: Record<string, unknown>,
  ) {
    setEdit({
      items: [],
      addCompany: companyData ? String(companyData.company ?? "") : undefined,
      input: {
        text: "",
        kind,
        parentId: parentId ?? null,
        data:
          kind === "bullet" || kind === "project_point"
            ? null
            : { ...companyData },
        source: "manual",
        position: items.length,
      },
      fields:
        kind === "role"
          ? [
              ...(companyData ? [] : ["company", "location", "website"]),
              "period",
            ]
          : (fields[kind] ?? []),
    });
  }
  async function saveEdit() {
    if (!edit || !edit.input.text.trim() || companyMissing(edit)) return;
    if (edit.items.length) {
      for (const item of edit.items) {
        await update(
          item,
          edit.companyOnly
            ? { data: { ...item.data, ...edit.input.data } }
            : { text: edit.input.text.trim(), data: edit.input.data },
        );
      }
    } else {
      await api.createExperienceBullet({
        ...edit.input,
        text: edit.input.text.trim(),
      });
      await refresh();
    }
    setEdit(null);
  }
  async function remove(group: Item[]) {
    for (const item of group) {
      await api.deleteExperienceBullet(item.id, jobId);
      if (!frozen) onDocumentChange?.((doc) => removeFromResume(doc, item.id));
      setItems((current) =>
        current.filter((row) => row.id !== item.id && row.parentId !== item.id),
      );
    }
    setDeletion(null);
    setRanked([]);
  }
  async function requestDelete(group: Item[]) {
    const usages = await Promise.all(
      group.map((item) => api.getLibraryItemUsage(item.id)),
    );
    const usage = {
      jobIds: [...new Set(usages.flatMap((u) => u.jobIds))],
      frozenJobIds: [...new Set(usages.flatMap((u) => u.frozenJobIds))],
    };
    if (usage.jobIds.length || usage.frozenJobIds.length)
      setDeletion({ items: group, usage });
    else await remove(group);
  }
  function trash(group: Item[], label: string) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Delete ${label}`}
        disabled={busy}
        className="ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
        onClick={() => void run(() => requestDelete(group))}
      >
        <Trash2 className="h-3 w-3" aria-hidden="true" />
      </Button>
    );
  }
  function companyMissing(current: Edit) {
    return (
      (current.companyOnly ||
        (!current.items.length && current.input.kind === "role")) &&
      !String(current.input.data?.company ?? "").trim()
    );
  }
  function fieldLabel(current: Edit, field: string) {
    return current.input.kind === "certification" && field === "website"
      ? "Link"
      : fieldNames[field];
  }
  function editForm(current: Edit) {
    return (
      <form
        className="space-y-2 border-l pl-3 py-2"
        aria-label="Edit library item"
        onSubmit={(event) => {
          event.preventDefault();
          void run(saveEdit);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            setEdit(null);
          }
        }}
      >
        {!current.companyOnly && (
          <Input
            autoFocus
            aria-label={current.input.kind === "role" ? "Position" : "Text"}
            required
            disabled={busy}
            value={current.input.text}
            onChange={(event) =>
              setEdit({
                ...current,
                input: { ...current.input, text: event.target.value },
              })
            }
          />
        )}
        {current.fields.map((field, index) => (
          <label
            key={field}
            htmlFor={`library-${field}`}
            className="block text-xs text-muted-foreground"
          >
            {fieldLabel(current, field)}
            <Input
              id={`library-${field}`}
              autoFocus={current.companyOnly && index === 0}
              aria-label={fieldLabel(current, field)}
              disabled={busy}
              value={String(current.input.data?.[field] ?? "")}
              onChange={(event) =>
                setEdit({
                  ...current,
                  input: {
                    ...current.input,
                    data: {
                      ...current.input.data,
                      [field]: event.target.value,
                    },
                  },
                })
              }
            />
          </label>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            type="submit"
            disabled={
              busy || !current.input.text.trim() || companyMissing(current)
            }
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => setEdit(null)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }
  function row(item: Item) {
    const isLine = item.kind === "bullet" || item.kind === "project_point";
    const lineSection =
      item.kind === "bullet" ? KIND_SECTION.role : KIND_SECTION.project;
    const rewordedLine =
      isLine && lineSection
        ? resumeItems(document, lineSection)
            .flatMap((entry) => getItemLines(entry))
            .find(
              (line) =>
                line.ref === item.id && !sameLineText(line.text, item.text),
            )
        : undefined;
    const reworded = Boolean(rewordedLine);
    const score = ranked.find((rank) => rank.bulletId === item.id);
    const editing = edit?.items[0]?.id === item.id && !edit.companyOnly;
    return (
      <div key={item.id} className="space-y-1 py-1">
        <div
          className={`group flex items-start gap-2 rounded-sm text-sm ${reworded ? REWORDED_TINT_CLASS : ""}`}
          title={rewordedLine?.text}
        >
          {tick([item], item.text)}
          {item.kind === "bullet" && (
            <button
              type="button"
              aria-label={`Drag duty: ${item.text}`}
              className="cursor-grab text-muted-foreground"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  BULLET_TRANSFER_TYPE,
                  JSON.stringify({ id: item.id, text: item.text }),
                );
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              ⋮⋮
            </button>
          )}
          <button
            type="button"
            className="min-w-0 flex-1 py-1 text-left hover:underline"
            disabled={busy}
            onClick={() => startEdit(item)}
          >
            {item.text}
            <span className="text-muted-foreground">
              {(fields[item.kind] ?? [])
                .map((field) => item.data?.[field])
                .filter(Boolean)
                .map((value) => ` · ${String(value)}`)
                .join("")}
            </span>
          </button>
          {trash([item], item.text)}
        </div>
        {editing && editForm(edit)}
        {item.kind === "bullet" && (
          <div className="pl-6 space-y-1">
            <InlineTags
              bullet={item}
              busy={busy}
              onSave={(tags) =>
                void run(async () => {
                  await update(item, { tags });
                })
              }
            />
            {score && (
              <p className="text-xs">
                <strong>{score.score}/100</strong> · {score.reason}
              </p>
            )}
            {onReferenceBullet && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onReferenceBullet(item)}
              >
                Chat reference
              </Button>
            )}
          </div>
        )}
        {item.kind === "skill" && skillPicker(item)}
      </div>
    );
  }
  function skillPicker(item: Item) {
    const linked = resumeItems(document).find(
      (entry) => entry.libraryId === item.id,
    );
    const selected = jobId
      ? Array.isArray(linked?.keywords)
        ? linked.keywords.filter(
            (value): value is string => typeof value === "string",
          )
        : []
      : keywords(item);
    function select(next: string[], library = items) {
      if (!jobId) return;
      onDocumentChange?.((doc) => {
        if (!next.length) return removeFromResume(doc, item.id);
        const added = addToResume(doc, item.id, library);
        const sections = added.sections as Record<
          string,
          { items?: Record<string, unknown>[] }
        >;
        const skills = sections.skills;
        if (!skills?.items) return added;
        return {
          ...added,
          sections: {
            ...added.sections,
            skills: {
              ...skills,
              items: skills.items.map((entry) =>
                entry.libraryId === item.id
                  ? { ...entry, keywords: next }
                  : entry,
              ),
            },
          },
        } as Doc;
      });
    }
    return (
      <div className="pl-6">
        <SearchableMultiSelect
          options={keywords(item)}
          value={selected}
          ariaLabel={`${item.text} keywords`}
          disabled={busy || Boolean(jobId && (!document || !onDocumentChange))}
          onValueChange={select}
          onCreate={(keyword) =>
            void run(async () => {
              const after = await update(item, {
                data: { ...item.data, keywords: [...keywords(item), keyword] },
              });
              if (!frozen)
                select(
                  [...selected, keyword],
                  items.map((row) => (row.id === item.id ? after : row)),
                );
            })
          }
          onDelete={(keyword) =>
            void run(async () => {
              await update(item, {
                data: {
                  ...item.data,
                  keywords: keywords(item).filter((word) => word !== keyword),
                },
              });
              if (!frozen) select(selected.filter((word) => word !== keyword));
            })
          }
          selectionEnabled={Boolean(jobId)}
        />
      </div>
    );
  }
  function addButton(
    kind: CandidateItemKind,
    parentId?: string,
    companyData?: Record<string, unknown>,
    label = names[kind],
  ) {
    const adding =
      edit &&
      !edit.items.length &&
      edit.input.kind === kind &&
      edit.input.parentId === (parentId ?? null) &&
      edit.addCompany ===
        (companyData ? String(companyData.company ?? "") : undefined);
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => startAdd(kind, parentId, companyData)}
        >
          + Add {label}
        </Button>
        {adding && editForm(edit)}
      </>
    );
  }
  const roles = items.filter((item) => item.kind === "role");
  const companies = new Map<string, Item[]>();
  for (const role of roles) {
    const key = String(role.data?.company ?? role.company ?? "Other");
    companies.set(key, [...(companies.get(key) ?? []), role]);
  }
  return (
    <div className="space-y-3">
      <section
        className="flex flex-wrap items-center gap-1"
        aria-label="Library sections"
      >
        {sections.map(([kind, label]) => (
          <Button
            key={kind}
            size="sm"
            variant="ghost"
            aria-pressed={section === kind}
            className="aria-pressed:bg-accent"
            onClick={() => {
              setSection(kind);
              setEdit(null);
            }}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || loading}
          onClick={() =>
            void run(async () => {
              const result = await api.syncCandidateLibrary();
              await refresh();
              toast.success(
                `Synced ${result.created}; skipped ${result.skipped}; linked ${result.linked}`,
              );
            })
          }
        >
          Sync from resumes
        </Button>
      </section>
      {loading ? (
        <output>Loading library…</output>
      ) : failed ? (
        <div role="alert">
          Could not load library.{" "}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          {section === "role" && (
            <>
              <DutyLibraryTools
                jobId={jobId}
                roles={roles}
                onRefresh={refresh}
                onRanked={setRanked}
              />
              {[...companies].map(([company, group]) => (
                <div key={company} className="border-t pt-2 space-y-1">
                  <div className="group flex items-center gap-2 text-sm font-medium">
                    {tick(group, company)}
                    <button
                      type="button"
                      disabled={busy}
                      className="text-left hover:underline"
                      onClick={() =>
                        setEdit({
                          items: group,
                          input: {
                            text: company,
                            data: {
                              company,
                              location: group[0].data?.location ?? "",
                              website: group[0].data?.website ?? "",
                            },
                          },
                          fields: ["company", "location", "website"],
                          companyOnly: true,
                        })
                      }
                    >
                      {company}
                      {group[0].data?.location
                        ? ` · ${String(group[0].data.location)}`
                        : ""}
                    </button>
                    {trash(group, company)}
                  </div>
                  {edit?.companyOnly &&
                    edit.items[0]?.id === group[0].id &&
                    editForm(edit)}
                  {group.map((role) => (
                    <div key={role.id} className="pl-4">
                      {row(role)}
                      <div className="pl-4">
                        {items
                          .filter(
                            (item) =>
                              item.parentId === role.id &&
                              item.kind === "bullet",
                          )
                          .map(row)}
                        {addButton("bullet", role.id)}
                      </div>
                    </div>
                  ))}
                  <div className="pl-4">
                    {addButton("role", undefined, {
                      company,
                      location: group[0].data?.location ?? "",
                      website: group[0].data?.website ?? "",
                    })}
                  </div>
                </div>
              ))}
              {addButton("role", undefined, undefined, "job")}
            </>
          )}
          {section !== "role" && (
            <>
              {items
                .filter((item) => item.kind === section)
                .map((item) => (
                  <div key={item.id} className="border-t pt-2">
                    {row(item)}
                    {section === "project" && (
                      <div className="pl-4">
                        {items
                          .filter(
                            (child) =>
                              child.parentId === item.id &&
                              child.kind === "project_point",
                          )
                          .map(row)}
                        {addButton("project_point", item.id)}
                      </div>
                    )}
                  </div>
                ))}
              {addButton(section)}
            </>
          )}
          {!items.some((item) => item.kind === section) && (
            <p className="text-sm text-muted-foreground">
              Add an item or sync from resumes to build your library.
            </p>
          )}
        </>
      )}
      <AlertDialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete from library?</AlertDialogTitle>
            <AlertDialogDescription>
              This item is used by{" "}
              {
                new Set([
                  ...(deletion?.usage.jobIds ?? []),
                  ...(deletion?.usage.frozenJobIds ?? []),
                ]).size
              }{" "}
              resumes. It will be removed from unapplied resumes.{" "}
              {deletion?.usage.frozenJobIds.length ?? 0} frozen resumes will
              keep their text.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (deletion) void run(() => remove(deletion.items));
              }}
            >
              Delete from library
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
