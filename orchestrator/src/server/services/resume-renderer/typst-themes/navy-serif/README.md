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
first. Hidden or empty sections are omitted; profiles appear in the contact line.

Experience descriptions can contain an intro followed by a list:

```html
<p>Built reliable platform services.</p>
<ul><li>Reduced deployment time.</li></ul>
```

The renderer preserves the intro separately. Editors must retain the paragraph when
updating the list. Other themes retain their existing description rendering.

## Common problems

- Missing Times New Roman: Typst tries Liberation Serif and TeX Gyre Termes, then
  falls back to its bundled Libertinus Serif. No font or package download is needed.
  Typst can emit warnings for unavailable preferred fonts while rendering successfully.
- Unexpected section order: the document's saved layout takes priority over the
  theme's default order.
- A missing section: check that the section and its items are visible and populated.

## Related pages

- [Resume design](/docs/features/design-resume)
