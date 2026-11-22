---
id: navy-serif
title: Navy Serif
description: An offline serif resume theme with navy headings and compact sections.
sidebar_position: 1
---

## What it is

Navy Serif is a self-contained Typst theme with centered contacts and profile links,
navy section rules, experience intros and bullets, and single-column certifications.

## Why it exists

It provides a traditional serif layout while keeping the resume's structured content
and explicit section order.

## How to use it

1. Select Typst as the PDF renderer.
2. Select **Navy Serif** from the theme selector.
3. Generate or preview the PDF.

A4 is the default; an explicit US Letter setting is respected. Without a document
layout order, sections appear as Skills, Certifications, Experience, Projects,
Education, Awards, followed by other populated sections. A nonempty summary appears
first unless explicitly placed elsewhere. Hidden or empty sections are omitted; profiles appear in the contact line.

Navy Serif always prints one column, including imported resumes with a saved sidebar.
Section order matches the co-work editor: all pages' main sections, then all pages'
sidebar sections, with unconfigured defaults appended. `sidebar-sample.json` contains
fictional data for checking this compatibility behavior.

Experience descriptions can contain an intro followed by a list:

```html
<p>Built reliable platform services.</p>
<ul>
  <li>Reduced deployment time.</li>
</ul>
```

Descriptions without list items render as prose with paragraph and line breaks.
Entry dates sit flush right on the company, school, or project line. The gap is
filled with space characters, so text extractors keep each date on its entry's line;
`dates-sample.json` contains fictional entries, including a wrapping one, for checking this.
Pages have 15mm padding on every side and 10.5pt body text. The headline appears
directly below the name, above the contact line. Skills show each navy category beside its
comma-separated tools, without bullets. Certifications show Title - Issuer - Date. Awards use compact
**Title - Awarder, Date**: description lines; missing fields omit their separators.
Education joins degree and area with “in”, omitting an area already in the degree.
Experience bullets use normal body leading with an additional 1.5pt between items. `wrap-sample.json` contains fictional
long items for checking this spacing.
With list items, only text before the list becomes the intro; list items render
once as bullets. Links allow HTTP, HTTPS, and mailto URLs; other schemes retain
the visible text without a link.

The renderer preserves the intro separately. Editors must retain the paragraph when
updating the list. Other themes retain their existing description rendering.

## Common problems

- Missing Times New Roman: Typst tries Liberation Serif and TeX Gyre Termes, then
  falls back to its bundled Libertinus Serif. The production Docker image includes
  Liberation Serif. No font or package download is needed.
  Typst can emit warnings for unavailable preferred fonts while rendering successfully.
- Unexpected section order: the document's saved layout takes priority over the
  theme's default order.
- A missing section: check that the section and its items are visible and populated.

## Related pages

- [Resume design](/docs/features/design-resume)
