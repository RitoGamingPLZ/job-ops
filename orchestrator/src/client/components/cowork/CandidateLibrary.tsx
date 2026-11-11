import * as api from "@client/api/cowork";
import {
  addToResume,
  applyLibraryUpdate,
  getItemLines,
  isContactOnResume,
  isOnResume,
  KIND_SECTION,
  removeFromResume,
  sameLineText,
  setContactOnResume,
} from "@shared/resume-links";
import type {
  CandidateItemKind,
  ExperienceBullet,
  ExperienceBulletInput,
  LibraryItemUsage,
  LibrarySyncResult,
  RankedBullet,
  ReactiveResumeV5Document,
} from "@shared/types";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { coworkError, DutyLibraryTools, InlineTags } from "./DutyLibrary";
import { REWORDED_TINT_CLASS } from "./rewordTint";

const sections = [
  ["contact", "Contact"],
  ["role", "Experience"],
  ["project", "Projects"],
  ["skill", "Skills"],
  ["education", "Education"],
  ["award", "Awards"],
  ["certification", "Certifications"],
] as const;
const names: Record<CandidateItemKind, string> = {
  contact: "contact",
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
  contact: ["value", "label", "network", "username"],
  role: ["period"],
  project: ["period", "website"],
  education: ["school", "location", "period"],
  award: ["date"],
  certification: ["issuer", "website", "date"],
};
const fieldNames: Record<string, string> = {
  value: "Value",
  label: "Label",
  network: "Network",
  username: "Username",
  url: "URL",
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
function fieldValue(field: string, value: unknown): string {
  if (field === "website" && value && typeof value === "object") {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url : "";
  }
  return typeof value === "string" ? value : "";
}
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
  items: providedItems,
  onItemsChange,
  onSync,
}: {
  /** Supplying items lets the workspace share one library load with its editor. */
  items?: ExperienceBullet[];
  onItemsChange?: (items: ExperienceBullet[]) => void;
  /** Workspace callback coordinates saving and revision reloads around Sync. */
  onSync?: () => Promise<LibrarySyncResult>;
  jobId?: string;
  frozen?: boolean;
  document?: Doc;
  onDocumentChange?: (update: (doc: Doc) => Doc) => void;
  onReferenceBullet?: (bullet: ExperienceBullet) => void;
}) {
  const tickId = useId();
  const [localItems, setLocalItems] = useState<Item[]>([]);
  const items = providedItems ?? localItems;
  const currentItems = useRef(items);
  currentItems.current = items;
  const controls = useRef({ providedItems, onItemsChange });
  controls.current = { providedItems, onItemsChange };
  const setItems = useCallback((update: SetStateAction<Item[]>) => {
    const next =
      typeof update === "function" ? update(currentItems.current) : update;
    currentItems.current = next;
    if (controls.current.providedItems === undefined) setLocalItems(next);
    controls.current.onItemsChange?.(next);
  }, []);
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
  }, [setItems]);
  useEffect(() => {
    if (providedItems !== undefined) {
      setLoading(false);
      return;
    }
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
  }, [providedItems, setItems]);
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
          item.kind === "contact"
            ? setContactOnResume(next, item, checked)
            : checked
              ? addToResume(next, item.id, items)
              : removeFromResume(next, item.id),
        doc,
      ),
    );
  }
  function tick(group: Item[], label: string) {
    if (!jobId) return null;
    const count = group.filter(
      (item) =>
        document &&
        (item.kind === "contact"
          ? isContactOnResume(document, item)
          : isOnResume(document, item.id)),
    ).length;
    return (
      <label
        htmlFor={`${tickId}-${group.map((item) => item.id).join("-")}`}
        className="-mx-1 inline-flex h-5 shrink-0 cursor-pointer items-center px-1"
      >
        <Checkbox
          id={`${tickId}-${group.map((item) => item.id).join("-")}`}
          className="h-3 w-3 [&_svg]:h-2.5 [&_svg]:w-2.5"
          aria-label={`Include ${label}`}
          disabled={busy || !document || !onDocumentChange}
          checked={
            count === group.length ? true : count ? "indeterminate" : false
          }
          onCheckedChange={(checked) => toggle(group, checked === true)}
        />
      </label>
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
            : kind === "contact"
              ? { type: "email", value: "" }
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
      const removedIds = [
        item.id,
        ...currentItems.current
          .filter((row) => row.parentId === item.id)
          .map((row) => row.id),
      ];
      if (!frozen)
        onDocumentChange?.((doc) =>
          removedIds.reduce(
            (next, id) =>
              item.kind === "contact"
                ? setContactOnResume(next, item, false)
                : removeFromResume(next, id),
            doc,
          ),
        );
      setItems((current) =>
        current.filter((row) => !removedIds.includes(row.id)),
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
        className={
          group[0]?.kind === "bullet"
            ? "h-7 w-7 shrink-0 p-0"
            : "ml-auto h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
        }
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
        className="space-y-0.5 py-0.5 text-xs"
        aria-label="Edit library item"
        onSubmit={(event) => {
          event.preventDefault();
          void run(saveEdit);
        }}
      >
        {current.input.kind === "contact" && (
          <select
            aria-label="Contact type"
            className="h-7 rounded border bg-background px-1 text-xs"
            disabled={busy}
            value={String(current.input.data?.type ?? "email")}
            onChange={(event) =>
              setEdit({
                ...current,
                input: {
                  ...current.input,
                  data: { ...current.input.data, type: event.target.value },
                },
              })
            }
          >
            {["email", "phone", "location", "website", "profile"].map(
              (type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ),
            )}
          </select>
        )}
        {!current.companyOnly &&
          current.input.kind !== "contact" &&
          (current.input.kind === "bullet" ||
          current.input.kind === "project_point" ? (
            <textarea
              aria-label="Text"
              rows={2}
              required
              disabled={busy}
              className="block min-h-0 w-full resize-none rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={current.input.text}
              ref={(node) => {
                if (node) {
                  node.style.height = "auto";
                  node.style.height = `${node.scrollHeight}px`;
                }
              }}
              onChange={(event) =>
                setEdit({
                  ...current,
                  input: { ...current.input, text: event.target.value },
                })
              }
            />
          ) : (
            <Input
              className="h-7 px-1.5 py-0.5 text-xs md:text-xs"
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
          ))}
        {current.fields
          .filter(
            (field) =>
              current.input.kind !== "contact" ||
              field === "value" ||
              (field === "label" && current.input.data?.type === "website") ||
              current.input.data?.type === "profile",
          )
          .map((field, index) => (
            <label
              key={field}
              htmlFor={`library-${field}`}
              className="block text-xs text-muted-foreground"
            >
              {fieldLabel(current, field)}
              <Input
                className="h-7 px-1.5 py-0.5 text-xs md:text-xs"
                required={current.input.kind === "contact" && field === "value"}
                id={`library-${field}`}
                autoFocus={current.companyOnly && index === 0}
                aria-label={fieldLabel(current, field)}
                disabled={busy}
                value={fieldValue(field, current.input.data?.[field])}
                onChange={(event) =>
                  setEdit({
                    ...current,
                    input: {
                      ...current.input,
                      ...(current.input.kind === "contact" && field === "value"
                        ? { text: event.target.value }
                        : {}),
                      data: {
                        ...current.input.data,
                        ...(current.input.kind === "contact" &&
                        current.input.data?.type === "profile" &&
                        field === "value" &&
                        current.input.data?.url
                          ? { url: event.target.value }
                          : {}),
                        [field]:
                          field === "website"
                            ? {
                                label: "",
                                ...(current.input.data?.website &&
                                typeof current.input.data.website === "object"
                                  ? current.input.data.website
                                  : {}),
                                url: event.target.value,
                              }
                            : event.target.value,
                      },
                    },
                  })
                }
              />
            </label>
          ))}
        <div className="flex gap-1">
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
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
            className="h-6 px-2 text-xs"
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
    const detailSuffix = (
      item.kind === "contact" ? ["type"] : (fields[item.kind] ?? [])
    )
      .map((field) => fieldValue(field, item.data?.[field]))
      .filter(Boolean)
      .map((value) => ` · ${String(value)}`)
      .join("");
    const displayText = item.text + detailSuffix;
    const hasTags =
      item.kind === "contact" ||
      item.kind === "bullet" ||
      item.kind === "project" ||
      item.kind === "education" ||
      item.kind === "award" ||
      item.kind === "certification";
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
    return (
      <div key={item.id} className="space-y-0.5 py-0.5">
        <div
          className={`group flex ${hasTags ? "items-center" : "items-start"} gap-1 rounded-sm text-xs ${reworded ? REWORDED_TINT_CLASS : ""}`}
          title={rewordedLine?.text}
        >
          {tick([item], item.text)}
          <button
            type="button"
            className={`min-w-0 flex-1 py-0.5 text-left hover:underline ${hasTags ? "truncate" : ""}`}
            title={hasTags ? (rewordedLine?.text ?? displayText) : undefined}
            disabled={busy}
            onClick={() => startEdit(item)}
          >
            {item.text}
            <span className="text-muted-foreground">{detailSuffix}</span>
          </button>
          {item.kind === "bullet" ? (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {onReferenceBullet && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  aria-label={`Chat reference: ${item.text}`}
                  title="Chat reference"
                  onClick={() => onReferenceBullet(item)}
                >
                  <MessageSquare className="h-3 w-3" aria-hidden="true" />
                </Button>
              )}
              {trash([item], item.text)}
            </div>
          ) : (
            trash([item], item.text)
          )}
        </div>
        {hasTags && (
          <div
            className={`flex min-w-0 items-start gap-1 ${jobId ? "pl-4" : ""}`}
          >
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
              <span
                className="shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium"
                title={score.reason}
                role="note"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus the score to read its rank reason.
                tabIndex={0}
                aria-label={`${score.score}/100: ${score.reason}`}
              >
                {score.score}/100
              </span>
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
      <div className="text-xs">
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
    const name = parentId
      ? `Add ${label} to ${items.find((item) => item.id === parentId)?.text ?? "item"}`
      : companyData
        ? `Add ${label} at ${String(companyData.company ?? "")}`
        : `Add ${label}`;
    const iconOnly = Boolean(parentId || companyData);
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-label={name}
        title={iconOnly ? name : undefined}
        className={iconOnly ? "h-6 w-6 p-0" : "h-7 px-2 text-xs"}
        onClick={() => startAdd(kind, parentId, companyData)}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {!iconOnly && ` Add ${label}`}
      </Button>
    );
  }
  const roles = items.filter((item) => item.kind === "role");
  const companies = new Map<string, Item[]>();
  for (const role of roles) {
    const key = String(role.data?.company ?? role.company ?? "Other");
    companies.set(key, [...(companies.get(key) ?? []), role]);
  }
  return (
    <div className="space-y-1.5">
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
            className="h-7 px-2 text-xs aria-pressed:bg-accent"
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
          className="h-7 px-2 text-xs"
          disabled={busy || loading}
          onClick={() =>
            void run(async () => {
              const result = await (onSync
                ? onSync()
                : api.syncCandidateLibrary());
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
              <div className="flex flex-wrap items-center gap-1 text-xs font-medium">
                <span className="mr-auto">Experience</span>
                <DutyLibraryTools
                  jobId={jobId}
                  roles={roles}
                  onRefresh={refresh}
                  onRanked={setRanked}
                />
                {addButton("role", undefined, undefined, "job")}
              </div>
              <Accordion
                key={jobId}
                type="multiple"
                defaultValue={
                  jobId
                    ? [...companies]
                        .filter(([, group]) =>
                          items.some(
                            (item) =>
                              item.kind === "bullet" &&
                              group.some((role) => role.id === item.parentId) &&
                              document &&
                              isOnResume(document, item.id),
                          ),
                        )
                        .map(([company]) => company)
                    : [...companies.keys()].slice(0, 1)
                }
              >
                {[...companies].map(([company, group]) => (
                  <AccordionItem
                    key={company}
                    value={company}
                    className="border-0 border-t pt-1"
                  >
                    <div className="group flex items-center gap-1 text-xs font-medium">
                      {tick(group, company)}
                      <button
                        type="button"
                        disabled={busy}
                        className="min-w-0 truncate text-left hover:underline"
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
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {addButton(
                          "role",
                          undefined,
                          {
                            company,
                            location: group[0].data?.location ?? "",
                            website: group[0].data?.website ?? "",
                          },
                          "role",
                        )}
                        {trash(group, company)}
                        <AccordionTrigger
                          aria-label={`Show roles for ${company}`}
                          className="h-6 w-6 flex-none justify-center p-0"
                        />
                      </div>
                    </div>
                    <AccordionContent className="ml-1.5 space-y-0.5 border-l pb-0.5 pl-2 text-xs">
                      {group.map((role) => {
                        const duties = items.filter(
                          (item) =>
                            item.parentId === role.id && item.kind === "bullet",
                        );
                        const selected = duties.filter(
                          (item) => document && isOnResume(document, item.id),
                        ).length;
                        return (
                          <div key={role.id}>
                            <div className="flex items-start gap-1">
                              <div className="min-w-0 flex-1">{row(role)}</div>
                              {jobId && (
                                <span className="shrink-0 py-1 text-xs text-muted-foreground">
                                  {`${selected}/${duties.length} duties`}
                                </span>
                              )}
                              {addButton("bullet", role.id, undefined, "duty")}
                            </div>
                            <div className="ml-1.5 border-l pl-2">
                              {duties.map(row)}
                            </div>
                          </div>
                        );
                      })}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </>
          )}
          {section !== "role" && (
            <>
              {items
                .filter((item) => item.kind === section)
                .map((item) => (
                  <div key={item.id} className="border-t pt-1">
                    {row(item)}
                    {section === "project" && (
                      <div className="ml-1.5 space-y-0.5 border-l pl-2">
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
            <p className="text-xs text-muted-foreground">
              {section === "contact"
                ? "Add a contact or sync to import missing contacts from your base resume."
                : "Add an item or sync from resumes to build your library."}
            </p>
          )}
        </>
      )}
      <Dialog
        open={Boolean(edit)}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {edit?.companyOnly
                ? "Edit company"
                : `${edit?.items.length ? "Edit" : "Add"} ${edit?.input.kind ? names[edit.input.kind] : "item"}`}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Update this candidate library item.
            </DialogDescription>
          </DialogHeader>
          {edit && editForm(edit)}
        </DialogContent>
      </Dialog>
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
