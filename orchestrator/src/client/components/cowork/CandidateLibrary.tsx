import * as api from "@client/api/cowork";
import {
  awardDataSchema,
  certificationDataSchema,
  educationDataSchema,
} from "@shared/candidate-library-schema";
import {
  addToResume,
  applyLibraryUpdate,
  changedLibraryFields,
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
  ResumeV5Document,
} from "@shared/types";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { type SetStateAction, useCallback, useEffect, useId, useRef, useState } from "react";
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
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { Textarea } from "@/components/ui/textarea";
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
const TAG_KINDS = new Set<CandidateItemKind>([
  "contact",
  "bullet",
  "project",
  "education",
  "award",
  "certification",
]);
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
  education: ["school", "location", "period", "area", "grade", "description", "website"],
  award: ["date", "awarder", "description", "website"],
  certification: ["issuer", "website", "date", "description"],
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
  area: "Area",
  grade: "Grade",
  description: "Description (HTML)",
  awarder: "Awarder",
  school: "School",
  issuer: "Issuer",
  date: "Date",
};
type Doc = ResumeV5Document;
type Item = ExperienceBullet;
type Edit = {
  items: Item[];
  input: ExperienceBulletInput;
  fields: string[];
  companyOnly?: boolean;
  addCompany?: string;
};
const keywords = (item: { data?: Record<string, unknown> | null }): string[] =>
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
function structuredDataSchema(kind: CandidateItemKind | undefined) {
  return kind === "education"
    ? educationDataSchema
    : kind === "award"
      ? awardDataSchema
      : kind === "certification"
        ? certificationDataSchema
        : null;
}
/** Submit only editable schema fields, including the strict website shape. */
function editableData(input: ExperienceBulletInput) {
  const schema = structuredDataSchema(input.kind);
  if (!schema) return input.data;
  const data = input.data ?? {};
  const rawWebsite =
    data.website && typeof data.website === "object"
      ? (data.website as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.keys(schema.parse({})).map((key) => [
      key,
      key === "schemaVersion"
        ? 2
        : key === "website"
          ? {
              url: fieldValue("website", data.website),
              label: typeof rawWebsite.label === "string" ? rawWebsite.label : "",
              ...(typeof rawWebsite.inlineLink === "boolean"
                ? { inlineLink: rawWebsite.inlineLink }
                : {}),
            }
          : fieldValue(key, data[key]),
    ]),
  );
}
function resumeItems(document?: Doc, sectionName?: string): Record<string, unknown>[] {
  const sections = document?.sections as
    | Record<string, { items?: Record<string, unknown>[] }>
    | undefined;
  const values = sectionName ? [sections?.[sectionName]] : Object.values(sections ?? {});
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
  const formId = useId();
  const [localItems, setLocalItems] = useState<Item[]>([]);
  const items = providedItems ?? localItems;
  const currentItems = useRef(items);
  currentItems.current = items;
  const controls = useRef({ providedItems, onItemsChange });
  controls.current = { providedItems, onItemsChange };
  const setItems = useCallback((update: SetStateAction<Item[]>) => {
    const next = typeof update === "function" ? update(currentItems.current) : update;
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
  const [dutyQuery, setDutyQuery] = useState("");
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
    const after = (await api.updateExperienceBullet(before.id, input, jobId)).bullet;
    setItems((current) => current.map((item) => (item.id === after.id ? after : item)));
    if (
      (input.text !== undefined && input.text !== before.text) ||
      (input.data !== undefined && JSON.stringify(input.data) !== JSON.stringify(before.data))
    )
      setRanked([]);
    if (!frozen) onDocumentChange?.((doc) => applyLibraryUpdate(doc, before, after));
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
          checked={count === group.length ? true : count ? "indeterminate" : false}
          onCheckedChange={(checked) => toggle(group, checked === true)}
        />
      </label>
    );
  }
  function startEdit(item: Item) {
    const schema = structuredDataSchema(item.kind);
    const parsed = schema?.safeParse(item.data ?? {});
    setEdit({
      items: [item],
      input: {
        text: item.text,
        kind: item.kind,
        data: parsed?.success ? parsed.data : item.data ? { ...item.data } : null,
        ...(TAG_KINDS.has(item.kind) ? { tags: item.tags } : {}),
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
          ? [...(companyData ? [] : ["company", "location", "website"]), "period"]
          : (fields[kind] ?? []),
    });
  }
  async function saveEdit() {
    if (!edit || !edit.input.text.trim() || companyMissing(edit)) return;
    if (edit.items.length) {
      for (const item of edit.items) {
        const after = await update(
          item,
          edit.companyOnly
            ? { data: { ...item.data, ...edit.input.data } }
            : {
                text: edit.input.text.trim(),
                data: editableData(edit.input),
                ...(edit.input.tags ? { tags: edit.input.tags } : {}),
              },
        );
        if (item.kind === "skill" && !edit.companyOnly && !frozen && jobId) {
          // New skills are ticked on the open resume; removed ones are dropped.
          const before = keywords(item);
          const kept = keywords(after);
          const selected = selectedKeywords(item);
          const added = kept.filter((word) => !before.includes(word));
          const next = [...selected.filter((word) => kept.includes(word)), ...added];
          if (added.length || next.length !== selected.length)
            selectKeywords(
              item,
              next,
              items.map((row) => (row.id === item.id ? after : row)),
            );
        }
      }
    } else {
      await api.createExperienceBullet({
        ...edit.input,
        data: editableData(edit.input),
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
        ...currentItems.current.filter((row) => row.parentId === item.id).map((row) => row.id),
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
      setItems((current) => current.filter((row) => !removedIds.includes(row.id)));
    }
    setDeletion(null);
    setRanked([]);
  }
  async function requestDelete(group: Item[]) {
    const usages = await Promise.all(group.map((item) => api.getLibraryItemUsage(item.id)));
    const usage = {
      jobIds: [...new Set(usages.flatMap((u) => u.jobIds))],
      frozenJobIds: [...new Set(usages.flatMap((u) => u.frozenJobIds))],
    };
    if (usage.jobIds.length || usage.frozenJobIds.length) setDeletion({ items: group, usage });
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
      (current.companyOnly || (!current.items.length && current.input.kind === "role")) &&
      !String(current.input.data?.company ?? "").trim()
    );
  }
  function fieldLabel(current: Edit, field: string) {
    return current.input.kind === "certification" && field === "website"
      ? "Link"
      : fieldNames[field];
  }
  function editForm(current: Edit) {
    const kind = current.input.kind ?? "bullet";
    const setInput = (input: ExperienceBulletInput) => setEdit({ ...current, input });
    const textLabel =
      kind === "role"
        ? "Position"
        : kind === "bullet"
          ? "Duty"
          : kind === "project_point"
            ? "Point"
            : kind === "skill"
              ? "Group name"
              : kind === "education"
                ? "Degree"
                : kind === "award" || kind === "certification"
                  ? "Title"
                  : "Name";
    const fieldClass = "grid gap-1.5 text-sm font-medium";
    return (
      <form
        className="space-y-3"
        aria-label="Edit library item"
        onSubmit={(event) => {
          event.preventDefault();
          void run(saveEdit);
        }}
      >
        {kind === "contact" && (
          <label htmlFor={`${formId}-type`} className={fieldClass}>
            Contact type
            <select
              id={`${formId}-type`}
              className="h-9 rounded-md border border-input bg-popover px-2 text-sm font-normal"
              disabled={busy}
              value={String(current.input.data?.type ?? "email")}
              onChange={(event) =>
                setInput({
                  ...current.input,
                  data: { ...current.input.data, type: event.target.value },
                })
              }
            >
              {["email", "phone", "location", "website", "profile"].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        )}
        {!current.companyOnly && kind !== "contact" && (
          <label htmlFor={`${formId}-text`} className={fieldClass}>
            {textLabel}
            {kind === "bullet" || kind === "project_point" ? (
              <Textarea
                id={`${formId}-text`}
                rows={4}
                required
                autoFocus
                disabled={busy}
                className="font-normal"
                value={current.input.text}
                onChange={(event) => setInput({ ...current.input, text: event.target.value })}
              />
            ) : (
              <Input
                id={`${formId}-text`}
                autoFocus
                required
                disabled={busy}
                className="font-normal"
                value={current.input.text}
                onChange={(event) => setInput({ ...current.input, text: event.target.value })}
              />
            )}
          </label>
        )}
        {current.fields
          .filter(
            (field) =>
              kind !== "contact" ||
              field === "value" ||
              (field === "label" && current.input.data?.type === "website") ||
              current.input.data?.type === "profile",
          )
          .map((field, index) => {
            const FieldInput = field === "description" ? Textarea : Input;
            return (
              <label key={field} htmlFor={`${formId}-${field}`} className={fieldClass}>
                {fieldLabel(current, field)}
                <FieldInput
                  id={`${formId}-${field}`}
                  className="font-normal"
                  required={kind === "contact" && field === "value"}
                  autoFocus={(current.companyOnly || kind === "contact") && index === 0}
                  disabled={busy}
                  value={fieldValue(field, current.input.data?.[field])}
                  onChange={(event) =>
                    setInput({
                      ...current.input,
                      ...(kind === "contact" && field === "value"
                        ? { text: event.target.value }
                        : {}),
                      data: {
                        ...current.input.data,
                        ...(kind === "contact" &&
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
                    })
                  }
                />
              </label>
            );
          })}
        {!current.companyOnly && kind === "skill" && (
          <label htmlFor={`${formId}-skills`} className={fieldClass}>
            Skills
            <MultiCombobox
              id={`${formId}-skills`}
              variant="inline"
              noun="skill"
              allowCustomValues
              value={keywords(current.input)}
              options={[
                ...new Set(items.filter((item) => item.kind === "skill").flatMap(keywords)),
              ].map((skill) => ({ value: skill, label: skill }))}
              disabled={busy}
              placeholder="Add skill…"
              inputAriaLabel="Add skill"
              onValueChange={(nextKeywords) =>
                setInput({
                  ...current.input,
                  data: { ...current.input.data, keywords: nextKeywords },
                })
              }
            />
          </label>
        )}
        {!current.companyOnly && TAG_KINDS.has(kind) && (
          <label htmlFor={`${formId}-tags`} className={fieldClass}>
            Tags
            <MultiCombobox
              id={`${formId}-tags`}
              variant="inline"
              noun="tag"
              allowCustomValues
              value={current.input.tags ?? []}
              options={[...new Set(items.flatMap((item) => item.tags))].map((tag) => ({
                value: tag,
                label: tag,
              }))}
              disabled={busy}
              placeholder="Add tag…"
              inputAriaLabel="Add tag"
              onValueChange={(tags) => setInput({ ...current.input, tags })}
            />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setEdit(null)}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || !current.input.text.trim() || companyMissing(current)}
          >
            Save
          </Button>
        </div>
      </form>
    );
  }
  function row(item: Item) {
    const detailSuffix = (item.kind === "contact" ? ["type"] : (fields[item.kind] ?? []))
      .map((field) => fieldValue(field, item.data?.[field]))
      .filter(Boolean)
      .map((value) => ` · ${String(value)}`)
      .join("");
    const displayText = item.text + detailSuffix;
    // A labelled contact link shows its label; the tooltip keeps the URL.
    const label = item.kind === "contact" ? String(item.data?.label ?? "").trim() : "";
    const hasTags = TAG_KINDS.has(item.kind);
    const isLine = item.kind === "bullet" || item.kind === "project_point";
    const lineSection = item.kind === "bullet" ? KIND_SECTION.role : KIND_SECTION.project;
    const rewordedLine =
      isLine && lineSection
        ? resumeItems(document, lineSection)
            .flatMap((entry) => getItemLines(entry))
            .find((line) => line.ref === item.id && !sameLineText(line.text, item.text))
        : undefined;
    // A linked entry whose fields differ on this resume, like a reworded line.
    const entrySection = isLine ? undefined : KIND_SECTION[item.kind];
    const changedEntry = entrySection
      ? resumeItems(document, entrySection)
          .map((entry) => (entry.libraryId === item.id ? changedLibraryFields(entry, items) : {}))
          .find((changed) => Object.keys(changed).length)
      : undefined;
    const changedTitle = changedEntry
      ? `Changed on this resume: ${Object.keys(changedEntry).join(", ")}`
      : undefined;
    const reworded = Boolean(rewordedLine || changedEntry);
    const score = ranked.find((rank) => rank.bulletId === item.id);
    return (
      <div key={item.id} className="space-y-0.5 py-0.5">
        <div
          className={`group flex ${hasTags ? "items-center" : "items-start"} gap-1 rounded-sm text-sm ${reworded ? REWORDED_TINT_CLASS : ""}`}
          title={rewordedLine?.text ?? changedTitle}
        >
          {tick([item], item.text)}
          <button
            type="button"
            className={`min-w-0 flex-1 py-0.5 text-left hover:underline ${hasTags ? "truncate" : ""}`}
            title={hasTags ? (rewordedLine?.text ?? displayText) : changedTitle}
            disabled={busy}
            onClick={() => startEdit(item)}
          >
            {label || item.text}
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
          <div className={`flex min-w-0 items-start gap-1 ${jobId ? "pl-4" : ""}`}>
            <InlineTags bullet={item} />
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
        {item.kind === "skill" && skillKeywords(item)}
      </div>
    );
  }
  function selectedKeywords(item: Item) {
    const linked = resumeItems(document).find((entry) => entry.libraryId === item.id);
    return Array.isArray(linked?.keywords)
      ? linked.keywords.filter((value): value is string => typeof value === "string")
      : [];
  }
  function selectKeywords(item: Item, next: string[], library = items) {
    if (!jobId) return;
    onDocumentChange?.((doc) => {
      if (!next.length) return removeFromResume(doc, item.id);
      const added = addToResume(doc, item.id, library);
      const sections = added.sections as Record<string, { items?: Record<string, unknown>[] }>;
      const skills = sections.skills;
      if (!skills?.items) return added;
      return {
        ...added,
        sections: {
          ...added.sections,
          skills: {
            ...skills,
            items: skills.items.map((entry) =>
              entry.libraryId === item.id ? { ...entry, keywords: next } : entry,
            ),
          },
        },
      } as Doc;
    });
  }
  function skillKeywords(item: Item) {
    const options = keywords(item);
    if (!options.length) return null;
    const selected = selectedKeywords(item);
    return (
      <div className={`flex flex-wrap gap-1 ${jobId ? "pl-4" : ""}`}>
        {options.map((keyword) => {
          const on = selected.includes(keyword);
          return jobId ? (
            <button
              key={keyword}
              type="button"
              aria-pressed={on}
              disabled={busy || !document || !onDocumentChange}
              className={`rounded border px-1 py-0.5 text-xs disabled:opacity-50 ${on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() =>
                selectKeywords(
                  item,
                  on ? selected.filter((word) => word !== keyword) : [...selected, keyword],
                )
              }
            >
              {keyword}
            </button>
          ) : (
            <span
              key={keyword}
              className="rounded border px-1 py-0.5 text-xs text-muted-foreground"
            >
              {keyword}
            </span>
          );
        })}
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
  const query = dutyQuery.trim().toLowerCase();
  function allDuties(role: Item) {
    return items.filter((item) => item.parentId === role.id && item.kind === "bullet");
  }
  const matches = (value: unknown) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query);
  /** A role matches the search by its title, company or location. */
  function roleMatches(role: Item) {
    return (
      !query ||
      matches(role.text) ||
      matches(role.data?.company ?? role.company) ||
      matches(role.data?.location)
    );
  }
  /** All duties of a matching role; otherwise those matching by text or tag. */
  function dutiesOf(role: Item) {
    const duties = allDuties(role);
    if (roleMatches(role)) return duties;
    return duties.filter((duty) => matches(duty.text) || duty.tags.some(matches));
  }
  function roleShown(role: Item) {
    return roleMatches(role) || dutiesOf(role).length > 0;
  }
  function dutyCount(role: Item) {
    if (!jobId) return null;
    const duties = allDuties(role);
    const selected = duties.filter((item) => document && isOnResume(document, item.id)).length;
    return (
      <span className="shrink-0 py-1 text-xs text-muted-foreground">
        {`${selected}/${duties.length} duties`}
      </span>
    );
  }
  const companies = new Map<string, Item[]>();
  for (const role of roles) {
    const key = String(role.data?.company ?? role.company ?? "Other");
    companies.set(key, [...(companies.get(key) ?? []), role]);
  }
  const shownCompanies = [...companies].filter(([, group]) => group.some(roleShown));
  return (
    <div className="space-y-1.5">
      <section className="flex flex-wrap items-center gap-1" aria-label="Library sections">
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
              const result = await (onSync ? onSync() : api.syncCandidateLibrary());
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
          <Button variant="ghost" disabled={busy} onClick={() => void run(refresh)}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {section === "role" && (
            <>
              <div className="flex flex-wrap items-center gap-1 text-sm font-medium">
                <span className="mr-auto">Experience</span>
                <DutyLibraryTools
                  jobId={jobId}
                  roles={roles}
                  onRefresh={refresh}
                  onRanked={setRanked}
                />
                {addButton("role", undefined, undefined, "job")}
              </div>
              <Input
                type="search"
                aria-label="Search experience"
                placeholder="Search job, company, location, duty or tag"
                className="h-7 px-2 text-xs md:text-xs"
                value={dutyQuery}
                onChange={(event) => setDutyQuery(event.target.value)}
              />
              {query && !shownCompanies.length && (
                <p className="text-xs text-muted-foreground">
                  Nothing matches “{dutyQuery.trim()}”.
                </p>
              )}
              <Accordion
                // Each search re-opens every matching job.
                key={`${jobId}:${query}`}
                type="multiple"
                defaultValue={
                  query
                    ? shownCompanies.map(([company]) => company)
                    : jobId
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
                {shownCompanies.map(([company, group]) => {
                  return (
                    <AccordionItem key={company} value={company} className="border-0 border-t pt-1">
                      <div className="group flex items-center gap-1 text-sm font-medium">
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
                          {group[0].data?.location ? ` · ${String(group[0].data.location)}` : ""}
                        </button>
                        <div className="ml-auto flex shrink-0 items-center gap-1 font-normal">
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
                      <AccordionContent className="ml-1.5 space-y-0.5 border-l pb-0.5 pl-2 text-sm">
                        {group.filter(roleShown).map((role) => (
                          <div key={role.id}>
                            <div className="flex items-start gap-1">
                              <div className="min-w-0 flex-1">{row(role)}</div>
                              {dutyCount(role)}
                              {addButton("bullet", role.id, undefined, "duty")}
                            </div>
                            <div className="ml-1.5 border-l pl-2">{dutiesOf(role).map(row)}</div>
                          </div>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </>
          )}
          {section !== "role" && (
            <>
              <div className="flex items-center justify-between gap-1 text-sm font-medium">
                {sections.find(([kind]) => kind === section)?.[1]}
                {addButton(section)}
              </div>
              {items
                .filter((item) => item.kind === section)
                .map((item) => (
                  <div key={item.id} className="border-t pt-1">
                    {row(item)}
                    {section === "project" && (
                      <div className="ml-1.5 space-y-0.5 border-l pl-2">
                        {items
                          .filter(
                            (child) => child.parentId === item.id && child.kind === "project_point",
                          )
                          .map(row)}
                        {addButton("project_point", item.id)}
                      </div>
                    )}
                  </div>
                ))}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
              {deletion?.usage.frozenJobIds.length ?? 0} frozen resumes will keep their text.
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
