export type ResumeV5LooseObject = Record<string, unknown>;

export interface ResumeV5Url extends ResumeV5LooseObject {
  url: string;
  label: string;
}

export interface ResumeV5ItemUrl extends ResumeV5Url {
  inlineLink?: boolean;
}

export interface ResumeV5Options extends ResumeV5LooseObject {
  showLinkInTitle: boolean;
}

export interface ResumeV5Role extends ResumeV5LooseObject {
  id: string;
  position: string;
  period: string;
  description: string;
}

export interface ResumeV5CustomField extends ResumeV5LooseObject {
  id: string;
  title?: string;
  icon: string;
  text: string;
  link: string;
}

export interface ResumeV5Picture extends ResumeV5LooseObject {
  hidden: boolean;
  url: string;
  size: number;
  rotation: number;
  aspectRatio: number;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  shadowColor: string;
  shadowWidth: number;
}

export interface ResumeV5Basics extends ResumeV5LooseObject {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: ResumeV5Url;
  customFieldsTitle?: string;
  customFields: ResumeV5CustomField[];
}

export interface ResumeV5SectionBase extends ResumeV5LooseObject {
  title: string;
  columns: number;
  hidden: boolean;
}

export interface ResumeV5SummarySection extends ResumeV5SectionBase {
  content: string;
}

export interface ResumeV5BaseItem extends ResumeV5LooseObject {
  id: string;
  hidden: boolean;
  options?: ResumeV5Options;
  libraryId?: string;
  bulletRefs?: (string | null)[];
}

export interface ResumeV5SummaryItem extends ResumeV5BaseItem {
  content: string;
}

export interface ResumeV5ProfileItem extends ResumeV5BaseItem {
  icon: string;
  network: string;
  username: string;
  website: ResumeV5ItemUrl;
}

export interface ResumeV5ExperienceItem extends ResumeV5BaseItem {
  company: string;
  position: string;
  location: string;
  period: string;
  website: ResumeV5ItemUrl;
  description: string;
  roles: ResumeV5Role[];
}

export interface ResumeV5EducationItem extends ResumeV5BaseItem {
  school: string;
  degree: string;
  area: string;
  grade: string;
  location: string;
  period: string;
  website: ResumeV5ItemUrl;
  description: string;
}

export interface ResumeV5ProjectItem extends ResumeV5BaseItem {
  name: string;
  period: string;
  website: ResumeV5ItemUrl;
  description: string;
}

export interface ResumeV5SkillItem extends ResumeV5BaseItem {
  icon: string;
  name: string;
  proficiency: string;
  level: number;
  keywords: string[];
}

export interface ResumeV5LanguageItem extends ResumeV5BaseItem {
  language: string;
  fluency: string;
  level: number;
}

export interface ResumeV5InterestItem extends ResumeV5BaseItem {
  icon: string;
  name: string;
  keywords: string[];
}

export interface ResumeV5AwardItem extends ResumeV5BaseItem {
  title: string;
  awarder: string;
  date: string;
  website: ResumeV5ItemUrl;
  description: string;
}

export interface ResumeV5CertificationItem extends ResumeV5BaseItem {
  title: string;
  issuer: string;
  date: string;
  website: ResumeV5ItemUrl;
  description: string;
}

export interface ResumeV5PublicationItem extends ResumeV5BaseItem {
  title: string;
  publisher: string;
  date: string;
  website: ResumeV5ItemUrl;
  description: string;
}

export interface ResumeV5VolunteerItem extends ResumeV5BaseItem {
  organization: string;
  location: string;
  period: string;
  website: ResumeV5ItemUrl;
  description: string;
}

export interface ResumeV5ReferenceItem extends ResumeV5BaseItem {
  name: string;
  position: string;
  website: ResumeV5ItemUrl;
  phone: string;
  description: string;
}

export interface ResumeV5CoverLetterItem extends ResumeV5BaseItem {
  recipient: string;
  content: string;
}

export interface ResumeV5ItemSection<TItem> extends ResumeV5SectionBase {
  items: TItem[];
}

export type ResumeV5SectionType =
  | "summary"
  | "profiles"
  | "experience"
  | "education"
  | "projects"
  | "skills"
  | "languages"
  | "interests"
  | "awards"
  | "certifications"
  | "publications"
  | "volunteer"
  | "references"
  | "cover-letter";

export type ResumeV5CustomSectionItem =
  | ResumeV5CoverLetterItem
  | ResumeV5SummaryItem
  | ResumeV5ProfileItem
  | ResumeV5ExperienceItem
  | ResumeV5EducationItem
  | ResumeV5ProjectItem
  | ResumeV5SkillItem
  | ResumeV5LanguageItem
  | ResumeV5InterestItem
  | ResumeV5AwardItem
  | ResumeV5CertificationItem
  | ResumeV5PublicationItem
  | ResumeV5VolunteerItem
  | ResumeV5ReferenceItem;

export interface ResumeV5CustomSection extends ResumeV5SectionBase {
  id: string;
  type: ResumeV5SectionType;
  items: ResumeV5CustomSectionItem[];
}

export interface ResumeV5MetadataLayoutPage extends ResumeV5LooseObject {
  fullWidth: boolean;
  main: string[];
  sidebar: string[];
}

export interface ResumeV5MetadataLayout extends ResumeV5LooseObject {
  sidebarWidth: number;
  pages: ResumeV5MetadataLayoutPage[];
}

export interface ResumeV5MetadataCss extends ResumeV5LooseObject {
  enabled: boolean;
  value: string;
}

export type ResumeV5PageFormat = "a4" | "letter" | "free-form";

export interface ResumeV5MetadataPage extends ResumeV5LooseObject {
  gapX: number;
  gapY: number;
  marginX: number;
  marginY: number;
  format: ResumeV5PageFormat;
  locale: string;
  hideIcons: boolean;
}

export type ResumeV5LevelType =
  | "hidden"
  | "circle"
  | "square"
  | "rectangle"
  | "rectangle-full"
  | "progress-bar"
  | "icon";

export interface ResumeV5MetadataLevel extends ResumeV5LooseObject {
  icon: string;
  type: ResumeV5LevelType;
}

export interface ResumeV5MetadataColors extends ResumeV5LooseObject {
  primary: string;
  text: string;
  background: string;
}

export interface ResumeV5MetadataTypographyBlock extends ResumeV5LooseObject {
  fontFamily: string;
  fontWeights: string[];
  fontSize: number;
  lineHeight: number;
}

export interface ResumeV5MetadataDesign extends ResumeV5LooseObject {
  level: ResumeV5MetadataLevel;
  colors: ResumeV5MetadataColors;
}

export interface ResumeV5MetadataTypography extends ResumeV5LooseObject {
  body: ResumeV5MetadataTypographyBlock;
  heading: ResumeV5MetadataTypographyBlock;
}

export interface ResumeV5Stylesheet {
  mode: "legacy" | "semantic";
  source: { languageVersion: number; text: string };
}

export interface ResumeV5StyleRule {
  id: string;
  label: string;
  enabled: boolean;
  target:
    | { scope: "global" }
    | { scope: "sectionType"; sectionType: ResumeV5SectionType }
    | { scope: "sectionId"; sectionId: string };
  slots: Record<string, Record<string, string | number>>;
}

export interface ResumeV5Metadata extends ResumeV5LooseObject {
  template: string;
  layout: ResumeV5MetadataLayout;
  css: ResumeV5MetadataCss;
  stylesheet?: ResumeV5Stylesheet;
  styleRules?: ResumeV5StyleRule[];
  page: ResumeV5MetadataPage;
  design: ResumeV5MetadataDesign;
  typography: ResumeV5MetadataTypography;
  notes: string;
}

export interface ResumeV5Sections extends ResumeV5LooseObject {
  profiles: ResumeV5ItemSection<ResumeV5ProfileItem>;
  experience: ResumeV5ItemSection<ResumeV5ExperienceItem>;
  education: ResumeV5ItemSection<ResumeV5EducationItem>;
  projects: ResumeV5ItemSection<ResumeV5ProjectItem>;
  skills: ResumeV5ItemSection<ResumeV5SkillItem>;
  languages: ResumeV5ItemSection<ResumeV5LanguageItem>;
  interests: ResumeV5ItemSection<ResumeV5InterestItem>;
  awards: ResumeV5ItemSection<ResumeV5AwardItem>;
  certifications: ResumeV5ItemSection<ResumeV5CertificationItem>;
  publications: ResumeV5ItemSection<ResumeV5PublicationItem>;
  volunteer: ResumeV5ItemSection<ResumeV5VolunteerItem>;
  references: ResumeV5ItemSection<ResumeV5ReferenceItem>;
}

export interface ResumeV5Document extends ResumeV5LooseObject {
  picture: ResumeV5Picture;
  basics: ResumeV5Basics;
  summary: ResumeV5SummarySection;
  sections: ResumeV5Sections;
  customSections: ResumeV5CustomSection[];
  metadata: ResumeV5Metadata;
}

export type DesignResumeJson = ResumeV5Document;

export interface DesignResumeAsset {
  id: string;
  documentId: string;
  kind: "picture";
  originalName: string;
  mimeType: string;
  byteSize: number;
  contentUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignResumeDocument {
  id: string;
  title: string;
  resumeJson: DesignResumeJson;
  revision: number;
  sourceResumeId: string | null;
  sourceMode: "v5" | null;
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assets: DesignResumeAsset[];
}

export interface DesignResumeStatusResponse {
  exists: boolean;
  documentId: string | null;
  updatedAt: string | null;
}

export interface DesignResumeImportResult {
  document: DesignResumeDocument;
}

export interface DesignResumePatchRequest {
  baseRevision: number;
  document?: DesignResumeJson;
  operations?: Array<{
    op: "add" | "remove" | "replace" | "move" | "copy" | "test";
    path: string;
    from?: string;
    value?: unknown;
  }>;
}

export interface DesignResumeExportResponse {
  fileName: string;
  document: DesignResumeJson;
}

export interface DesignResumePdfResponse {
  fileName: string;
  pdfUrl: string;
  generatedAt: string;
}

export type DesignResumeAiFieldValueType = "plain_text" | "html" | "string_list";

export interface DesignResumeAiFieldSuggestionRequest {
  document: DesignResumeJson;
  field: {
    path: string;
    label: string;
    value: string | string[];
    valueType: DesignResumeAiFieldValueType;
    section?: string | null;
    itemLabel?: string | null;
  };
  prompt: string;
}

export interface DesignResumeAiFieldSuggestionResponse {
  message: string;
  suggestion: string | string[];
  valueType: DesignResumeAiFieldValueType;
}
