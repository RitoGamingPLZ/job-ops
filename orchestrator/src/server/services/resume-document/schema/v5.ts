import { asRecord } from "@shared/utils/type-conversion";
import { z } from "zod";

const templateNames = [
  "azurill",
  "bronzor",
  "chikorita",
  "ditgar",
  "ditto",
  "gengar",
  "glalie",
  "kakuna",
  "lapras",
  "leafish",
  "meowth",
  "onyx",
  "pikachu",
  "rhyhorn",
] as const;

const templateSchema = z.enum(templateNames);

const iconSchema = z.string();

const itemOptionsSchema = z
  .object({
    showLinkInTitle: z.boolean().catch(false),
  })
  .catch({ showLinkInTitle: false });

const urlSchema = z.object({
  url: z.string(),
  label: z.string(),
});

const itemUrlSchema = urlSchema.extend({
  inlineLink: z.boolean().optional(),
});

const pictureSchema = z.object({
  hidden: z.boolean(),
  url: z.string(),
  size: z.number().min(32).max(512),
  rotation: z.number().min(0).max(360),
  aspectRatio: z.number().min(0.5).max(2.5),
  borderRadius: z.number().min(0).max(100),
  borderColor: z.string(),
  borderWidth: z.number().min(0),
  shadowColor: z.string(),
  shadowWidth: z.number().min(0),
});

const customFieldSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  icon: iconSchema,
  text: z.string(),
  link: z.string().catch(""),
});

const basicsSchema = z.object({
  name: z.string(),
  headline: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  website: urlSchema,
  customFieldsTitle: z.string().optional(),
  customFields: z.array(customFieldSchema),
});

const summarySchema = z.object({
  title: z.string(),
  columns: z.number(),
  hidden: z.boolean(),
  content: z.string(),
});

const baseItemSchema = z.object({
  id: z.string(),
  hidden: z.boolean(),
  options: itemOptionsSchema.optional(),
  /** job-ops candidate library: the library item this resume item came from. */
  libraryId: z.string().optional(),
  /** job-ops candidate library: library id per bullet line (null = unlinked). */
  bulletRefs: z.array(z.string().nullable()).optional(),
});

const summaryItemSchema = baseItemSchema.extend({
  content: z.string(),
});

const awardItemSchema = baseItemSchema.extend({
  title: z.string().min(1),
  awarder: z.string(),
  date: z.string(),
  website: itemUrlSchema,
  description: z.string(),
});

const certificationItemSchema = baseItemSchema.extend({
  title: z.string().min(1),
  issuer: z.string(),
  date: z.string(),
  website: itemUrlSchema,
  description: z.string(),
});

const educationItemSchema = baseItemSchema.extend({
  school: z.string().min(1),
  degree: z.string(),
  area: z.string(),
  grade: z.string(),
  location: z.string(),
  period: z.string(),
  website: itemUrlSchema,
  description: z.string(),
});

const roleItemSchema = z.object({
  id: z.string(),
  position: z.string(),
  period: z.string(),
  description: z.string(),
});

const experienceItemSchema = baseItemSchema.extend({
  company: z.string().min(1),
  position: z.string(),
  location: z.string(),
  period: z.string(),
  website: itemUrlSchema,
  description: z.string(),
  roles: z.array(roleItemSchema).catch([]),
});

const interestItemSchema = baseItemSchema.extend({
  icon: iconSchema,
  name: z.string().min(1),
  keywords: z.array(z.string()).catch([]),
});

const languageItemSchema = baseItemSchema.extend({
  language: z.string().min(1),
  fluency: z.string(),
  level: z.number().min(0).max(5).catch(0),
});

const profileItemSchema = baseItemSchema.extend({
  icon: iconSchema,
  network: z.string().min(1),
  username: z.string(),
  website: itemUrlSchema,
});

const projectItemSchema = baseItemSchema.extend({
  name: z.string().min(1),
  period: z.string(),
  website: itemUrlSchema,
  description: z.string(),
});

const publicationItemSchema = baseItemSchema.extend({
  title: z.string().min(1),
  publisher: z.string(),
  date: z.string(),
  website: itemUrlSchema,
  description: z.string(),
});

const referenceItemSchema = baseItemSchema.extend({
  name: z.string().min(1),
  position: z.string(),
  website: itemUrlSchema,
  phone: z.string(),
  description: z.string(),
});

const skillItemSchema = baseItemSchema.extend({
  icon: iconSchema,
  name: z.string().trim().min(1),
  proficiency: z.string(),
  level: z.number().min(0).max(5).catch(0),
  keywords: z.array(z.string()).catch([]),
});

const volunteerItemSchema = baseItemSchema.extend({
  organization: z.string().min(1),
  location: z.string(),
  period: z.string(),
  website: itemUrlSchema,
  description: z.string(),
});

const coverLetterItemSchema = baseItemSchema.extend({
  recipient: z.string(),
  content: z.string(),
});

const baseSectionSchema = z.object({
  title: z.string(),
  columns: z.number(),
  hidden: z.boolean(),
});

const awardsSectionSchema = baseSectionSchema.extend({
  items: z.array(awardItemSchema),
});

const certificationsSectionSchema = baseSectionSchema.extend({
  items: z.array(certificationItemSchema),
});

const educationSectionSchema = baseSectionSchema.extend({
  items: z.array(educationItemSchema),
});

const experienceSectionSchema = baseSectionSchema.extend({
  items: z.array(experienceItemSchema),
});

const interestsSectionSchema = baseSectionSchema.extend({
  items: z.array(interestItemSchema),
});

const languagesSectionSchema = baseSectionSchema.extend({
  items: z.array(languageItemSchema),
});

const profilesSectionSchema = baseSectionSchema.extend({
  items: z.array(profileItemSchema),
});

const projectsSectionSchema = baseSectionSchema.extend({
  items: z.array(projectItemSchema),
});

const publicationsSectionSchema = baseSectionSchema.extend({
  items: z.array(publicationItemSchema),
});

const referencesSectionSchema = baseSectionSchema.extend({
  items: z.array(referenceItemSchema),
});

const skillsSectionSchema = baseSectionSchema.extend({
  items: z.array(skillItemSchema),
});

const volunteerSectionSchema = baseSectionSchema.extend({
  items: z.array(volunteerItemSchema),
});

const sectionsSchema = z.object({
  profiles: profilesSectionSchema,
  experience: experienceSectionSchema,
  education: educationSectionSchema,
  projects: projectsSectionSchema,
  skills: skillsSectionSchema,
  languages: languagesSectionSchema,
  interests: interestsSectionSchema,
  awards: awardsSectionSchema,
  certifications: certificationsSectionSchema,
  publications: publicationsSectionSchema,
  volunteer: volunteerSectionSchema,
  references: referencesSectionSchema,
});

const sectionTypeSchema = z.enum([
  "summary",
  "profiles",
  "experience",
  "education",
  "projects",
  "skills",
  "languages",
  "interests",
  "awards",
  "certifications",
  "publications",
  "volunteer",
  "references",
  "cover-letter",
]);

const customSectionItemSchema = z.union([
  coverLetterItemSchema,
  summaryItemSchema,
  profileItemSchema,
  experienceItemSchema,
  educationItemSchema,
  projectItemSchema,
  skillItemSchema,
  languageItemSchema,
  interestItemSchema,
  awardItemSchema,
  certificationItemSchema,
  publicationItemSchema,
  volunteerItemSchema,
  referenceItemSchema,
]);

const customSectionSchema = baseSectionSchema.extend({
  id: z.string(),
  type: sectionTypeSchema,
  items: z.array(customSectionItemSchema),
});

const customSectionsSchema = z.array(customSectionSchema);

const fontWeightSchema = z.enum(["100", "200", "300", "400", "500", "600", "700", "800", "900"]);

const typographyItemSchema = z.object({
  fontFamily: z.string(),
  fontWeights: z.array(fontWeightSchema).catch(["400"]),
  fontSize: z.number().min(6).max(24).catch(11),
  lineHeight: z.number().min(0.5).max(4).catch(1.5),
});

const pageLayoutSchema = z.object({
  fullWidth: z.boolean(),
  main: z.array(z.string()),
  sidebar: z.array(z.string()),
});

const layoutSchema = z.object({
  sidebarWidth: z.number().min(10).max(50).catch(35),
  pages: z.array(pageLayoutSchema),
});

const cssSchema = z.object({
  enabled: z.boolean(),
  value: z.string(),
});

const stylesheetSchema = z.object({
  mode: z.enum(["legacy", "semantic"]),
  source: z
    .object({
      languageVersion: z.number().int().positive(),
      text: z.string(),
    })
    .strict(),
});

const styleIntentSchema = z
  .object({
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    borderColor: z.string().optional(),
    textDecorationColor: z.string().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fontSize: z.number().min(6).max(48).optional(),
    fontWeight: fontWeightSchema.optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    lineHeight: z.number().min(0.5).max(4).optional(),
    letterSpacing: z.number().min(-16).max(16).optional(),
    textDecoration: z.enum(["none", "underline", "line-through"]).optional(),
    textDecorationStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
    textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
    padding: z.number().min(-72).max(72).optional(),
    paddingTop: z.number().min(-72).max(72).optional(),
    paddingRight: z.number().min(-72).max(72).optional(),
    paddingBottom: z.number().min(-72).max(72).optional(),
    paddingLeft: z.number().min(-72).max(72).optional(),
    marginTop: z.number().min(-72).max(72).optional(),
    marginRight: z.number().min(-72).max(72).optional(),
    marginBottom: z.number().min(-72).max(72).optional(),
    marginLeft: z.number().min(-72).max(72).optional(),
    rowGap: z.number().min(-72).max(72).optional(),
    columnGap: z.number().min(-72).max(72).optional(),
    borderStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    borderWidth: z.number().min(0).optional(),
    borderRadius: z.number().min(0).optional(),
  })
  .strict();

const styleSlotSchema = z.enum([
  "section",
  "heading",
  "item",
  "text",
  "secondaryText",
  "link",
  "icon",
  "level",
  "richParagraph",
  "richList",
  "richListItemRow",
  "richListItemContent",
  "richLink",
  "richBold",
  "richMark",
]);

const styleRuleSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().catch(""),
    enabled: z.boolean().catch(true),
    target: z.discriminatedUnion("scope", [
      z.object({ scope: z.literal("global") }).strict(),
      z
        .object({
          scope: z.literal("sectionType"),
          sectionType: sectionTypeSchema,
        })
        .strict(),
      z.object({ scope: z.literal("sectionId"), sectionId: z.string().min(1) }).strict(),
    ]),
    slots: z
      .record(styleSlotSchema, styleIntentSchema)
      .refine(
        (slots) => Object.values(slots).some(Boolean),
        "At least one style slot must be configured.",
      ),
  })
  .strict();

const defaultCss = { enabled: false, value: "" };

const pageSchema = z.object({
  gapX: z.number().min(0),
  gapY: z.number().min(0),
  marginX: z.number().min(0),
  marginY: z.number().min(0),
  format: z.enum(["a4", "letter", "free-form"]).catch("a4"),
  locale: z.string().catch("en-US"),
  hideIcons: z.boolean().catch(false),
});

const levelDesignSchema = z.object({
  icon: iconSchema,
  type: z.enum([
    "hidden",
    "circle",
    "square",
    "rectangle",
    "rectangle-full",
    "progress-bar",
    "icon",
  ]),
});

const colorDesignSchema = z.object({
  primary: z.string(),
  text: z.string(),
  background: z.string(),
});

const designSchema = z.object({
  level: levelDesignSchema,
  colors: colorDesignSchema,
});

const typographySchema = z.object({
  body: typographyItemSchema,
  heading: typographyItemSchema,
});

export const metadataSchema = z.object({
  template: templateSchema.catch("onyx"),
  layout: layoutSchema,
  css: cssSchema.catch(defaultCss),
  stylesheet: stylesheetSchema.optional(),
  styleRules: z.array(styleRuleSchema).optional(),
  page: pageSchema,
  design: designSchema,
  typography: typographySchema,
  notes: z.string(),
});

function migrateLegacyInlineLinkOptions(input: unknown): unknown {
  const source = asRecord(input);
  if (!source) return input;

  let changed = false;
  const migrateSection = (value: unknown): unknown => {
    const section = asRecord(value);
    if (!section || !Array.isArray(section.items)) return value;

    let sectionChanged = false;
    const items = section.items.map((item) => {
      const itemRecord = asRecord(item);
      const website = asRecord(itemRecord?.website);
      const options = asRecord(itemRecord?.options);
      if (
        !itemRecord ||
        !website ||
        typeof website.inlineLink === "boolean" ||
        typeof options?.showLinkInTitle !== "boolean"
      ) {
        return item;
      }

      changed = true;
      sectionChanged = true;
      return {
        ...itemRecord,
        website: {
          ...website,
          inlineLink: options.showLinkInTitle,
        },
      };
    });

    return sectionChanged ? { ...section, items } : value;
  };

  const sections = asRecord(source.sections);
  const nextSections = sections
    ? Object.fromEntries(
        Object.entries(sections).map(([key, section]) => [key, migrateSection(section)]),
      )
    : source.sections;
  const customSections = Array.isArray(source.customSections)
    ? source.customSections.map(migrateSection)
    : source.customSections;

  return changed ? { ...source, sections: nextSections, customSections } : input;
}

const v5ResumeDataObjectSchema = z.object({
  picture: pictureSchema,
  basics: basicsSchema,
  summary: summarySchema,
  sections: sectionsSchema,
  customSections: customSectionsSchema,
  metadata: metadataSchema,
});

export const v5ResumeDataSchema = z.preprocess(
  migrateLegacyInlineLinkOptions,
  v5ResumeDataObjectSchema,
);

export type V5ResumeData = z.infer<typeof v5ResumeDataSchema>;

export const defaultV5ResumeData: V5ResumeData = {
  picture: {
    hidden: false,
    url: "",
    size: 80,
    rotation: 0,
    aspectRatio: 1,
    borderRadius: 0,
    borderColor: "rgba(0, 0, 0, 0.5)",
    borderWidth: 0,
    shadowColor: "rgba(0, 0, 0, 0.5)",
    shadowWidth: 0,
  },
  basics: {
    name: "",
    headline: "",
    email: "",
    phone: "",
    location: "",
    website: { url: "", label: "" },
    customFields: [],
  },
  summary: {
    title: "",
    columns: 1,
    hidden: false,
    content: "",
  },
  sections: {
    profiles: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    experience: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    education: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    projects: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    skills: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    languages: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    interests: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    awards: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    certifications: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    publications: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    volunteer: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
    references: {
      title: "",
      columns: 1,
      hidden: false,
      items: [],
    },
  },
  customSections: [],
  metadata: {
    template: "onyx",
    layout: {
      sidebarWidth: 35,
      pages: [
        {
          fullWidth: false,
          main: [
            "profiles",
            "summary",
            "education",
            "experience",
            "projects",
            "volunteer",
            "references",
          ],
          sidebar: ["skills", "certifications", "awards", "languages", "interests", "publications"],
        },
      ],
    },
    css: { enabled: false, value: "" },
    page: {
      gapX: 4,
      gapY: 6,
      marginX: 14,
      marginY: 12,
      format: "a4",
      locale: "en-US",
      hideIcons: false,
    },
    design: {
      colors: {
        primary: "rgba(220, 38, 38, 1)",
        text: "rgba(0, 0, 0, 1)",
        background: "rgba(255, 255, 255, 1)",
      },
      level: {
        icon: "star",
        type: "circle",
      },
    },
    typography: {
      body: {
        fontFamily: "IBM Plex Serif",
        fontWeights: ["400", "500"],
        fontSize: 10,
        lineHeight: 1.5,
      },
      heading: {
        fontFamily: "IBM Plex Serif",
        fontWeights: ["600"],
        fontSize: 14,
        lineHeight: 1.5,
      },
    },
    notes: "",
  },
};

export function parseV5ResumeData(input: unknown): V5ResumeData {
  return v5ResumeDataSchema.parse(input);
}

export function safeParseV5ResumeData(input: unknown) {
  return v5ResumeDataSchema.safeParse(input);
}
