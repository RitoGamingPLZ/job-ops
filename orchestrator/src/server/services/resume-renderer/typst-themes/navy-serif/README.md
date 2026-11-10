---
id: navy-serif
title: Navy Serif
description: An offline serif resume theme with navy headings and compact sections.
sidebar_position: 1
---

## What it is

Navy Serif is a self-contained Typst theme with centered contacts and profile links,
navy section rules, experience intros and bullets, and two-column certifications.

## Why it exists

It provides a traditional serif layout while keeping the resume's structured content
and explicit section order.

## How to use it

1. Select Typst as the PDF renderer.
2. Select **Navy Serif** from the theme selector.
3. Generate or preview the PDF.

A4 is the default; an explicit US Letter setting is respected. Without a document
layout order, sections appear as Skills, Certifications, Experiences, Projects,
Education, Awards, followed by other populated sections. A nonempty summary appears
first in single-column mode. Hidden or empty sections are omitted; profiles appear in the contact line.

To put skills and certifications in a left sidebar, save this document metadata:

```json
{"layout":{"sidebarWidth":30,"pages":[{"sidebar":["skills","certifications"],"main":["summary","experience","projects","education","awards"]}]}}
```

`sidebarWidth` is a percentage, defaults to 30 and is clamped to 25–35. The gutter
is 6mm. The header spans both columns with an 8pt gap before the body; headings
span their own column. Sidebar list markers start at the column edge with an 8pt
text indent. Each column
follows its saved order. Unplaced sections follow the main sections. An empty sidebar
keeps single-column rendering. Certifications use one column inside the sidebar
and two otherwise. `sidebar-sample.json` provides fictional data for this layout.

Experience descriptions can contain an intro followed by a list:

```html
<p>Built reliable platform services.</p>
<ul><li>Reduced deployment time.</li></ul>
```

Descriptions without list items render as prose with paragraph and line breaks.
Pages have 12mm padding on every side. Skills show each navy category above its
comma-separated tools, without bullets. Awards use compact **Title**: summary lines.
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
