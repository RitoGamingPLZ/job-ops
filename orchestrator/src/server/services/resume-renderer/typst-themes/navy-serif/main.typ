// Self-contained: no package downloads or external assets are required.
#let source = json(__RESUME_DATA_PATH__)
#let value(item, key) = item.at(key, default: none)
#let str-of(item, key) = { let v = value(item, key); if v == none { "" } else { v } }
#let items(key) = source.at(key, default: ())
// Typography tokens shared with the co-work editor (shared/src/resume-style/navy-serif.ts).
#let st = __NAVY_STYLE__
#let navy = st.accent
#let default-order = ("skills", "certifications", "experience", "projects", "education", "awards", "languages", "interests", "publications", "volunteer", "references")
#let order = if source.at("defaultSectionOrder", default: false) or value(source, "sectionOrder") == none { default-order } else { source.sectionOrder }
#let titles = source.at("sectionTitles", default: (:))
#let title(key, fallback) = {
  let t = titles.at(key, default: fallback)
  if key == "skills" and t == "Technical Skills" { "Skills" }
  else { t }
}
// Title and author metadata help ATS and PDF indexers identify the file.
#set document(title: source.name + " - Resume", author: source.name)
#set page(paper: __PAGE_PAPER__, margin: (x: st.marginX, y: st.marginY))
// CSS-style line boxes: each line is lineHeight x size tall with the glyphs placed
// as a browser does (half-leading around the Times ascent 0.891 / descent 0.216),
// so every spacing token means the same gap here and in the editor.
#set text(font: st.font, size: st.body, fill: st.text, lang: "en", top-edge: (st.lineHeight + 0.675) / 2 * 1em, bottom-edge: -(st.lineHeight - 0.675) / 2 * 1em)
#set par(leading: 0pt, spacing: 0pt)
#set block(spacing: 0pt)
// The marker sits markerIndent from the text edge and the text starts at textIndent.
#set list(marker: box(width: st.textIndent - st.markerIndent, text(size: st.marker)[•]), indent: st.markerIndent, body-indent: 0pt, tight: false, spacing: st.bulletGap)
#show link: it => text(fill: st.link, underline(it))
#let linked(label, url) = if url == "" { label } else { link(url, label) }
// Profile URLs are printed as text, since many ATS ignore link targets.
#let bare-url(url) = url.replace(regex("^https?://(www\\.)?"), "").trim("/", at: end)
#let accent(body, size: st.entry) = text(fill: navy, weight: st.entryWeight, style: st.entryStyle, size: size, body)
#let section(key, fallback, body) = if body != [] {
  block(above: st.sectionAbove, below: 0pt, sticky: true)[
    #text(fill: navy, weight: st.strongWeight, size: st.section, title(key, fallback))
    // A line has no height; its stroke is centred on it.
    #v(st.headingToRule + st.rule / 2)
    #line(length: 100%, stroke: (paint: navy, thickness: st.rule))
    #v(st.ruleToBody + st.rule / 2)
  ]
  body
}
// Bullets/summary are escaped by convertDocFieldsToTypst; other fields are plain strings.
#let markup(s) = eval(s, mode: "markup")
#let bullets(entry) = {
  let b = entry.at("listBullets", default: entry.at("bullets", default: ()))
  if b.len() > 0 { list(..b.map(markup)) }
}
// Dates sit flush right on the heading's own text line. The gap is filled with real
// space glyphs: an empty gap (1fr spacing, grids, placed boxes) lets pdfminer-style ATS parsers
// split the date into a separate box and move it away from its entry.
// Keep an entry on one page when it fits on one; a longer entry still breaks
// (an unbreakable block taller than the page would be cut off).
#let keep(body) = layout(size => block(breakable: measure(block(width: size.width, body)).height > size.height, body))
#let row(left, date) = block(if date == "" { left } else { [#left#box(width: 1fr, repeat(" "))#accent(date)] })
#align(center)[
  #text(fill: navy, weight: st.strongWeight, size: st.name, upper(source.name))
  #if str-of(source, "headline") != "" { [\ #text(size: st.headline, weight: st.strongWeight, source.headline)] }
  #v(st.nameToContact)
  #text(size: st.contact)[
    #let contacts = source.contactItems.map(c => {
      let prefix = if str-of(c, "kind") == "phone" { "Tel: " } else if str-of(c, "kind") == "email" { "Email: " } else { "" }
      [#prefix#linked(c.text, str-of(c, "url"))]
    })
    #if str-of(source, "location") != "" { contacts.push(source.location) }
    #for p in source.profileItems { let url = str-of(p, "url"); let label = str-of(p, "label"); contacts.push(linked(if label != "" { label } else if url == "" { p.network } else { bare-url(url) }, url)) }
    #contacts.join([ | ])
  ]
]
#let render-sections(keys) = for key in keys {
  if key == "summary" and str-of(source, "summary") != "" {
    section("summary", "Summary", markup(source.summary))
  } else if key == "skills" and items("skillGroups").len() > 0 {
    section(key, "Skills", [#for g in items("skillGroups") {
      block(above: 0pt, below: st.skillGap)[
        #if g.name != "" [#text(fill: navy, weight: st.strongWeight, g.name + ":") ]#g.keywords.join(", ")
      ]
    }])
  } else if key == "certifications" and items(key).len() > 0 {
    // One column: side-by-side cells are read as one merged line by ATS parsers.
    section(key, "Certifications", list(spacing: st.lineItemGap, ..items(key).map(c => {
      let parts = (c.title, str-of(c, "subtitle"), str-of(c, "date")).filter(p => p != "")
      linked(parts.join(" - "), str-of(c, "url"))
    })))
  } else if key in ("experience", "education", "projects", "volunteer", "publications", "references") and items(key).len() > 0 {
    section(key, upper(key.slice(0, 1)) + key.slice(1), [
      #for entry in items(key) {
        keep[
          #block(sticky: true, below: st.entryToBody)[
            #if key == "experience" {
              let position = str-of(entry, "position")
              accent(if position != "" { position } else { str-of(entry, "subtitle") }, size: st.position)
              linebreak()
              let location = str-of(entry, "location")
              row(accent(entry.title + if location != "" { " - " + location } else { "" }), str-of(entry, "date"))
            } else {
              // The project name stays navy when linked: its own fill overrides the link colour.
              let label = if key == "projects" { let url = str-of(entry, "url"); if url == "" { underline(accent(entry.title)) } else { link(url, accent(entry.title)) } } else { accent(entry.title) }
              row(label, str-of(entry, "date"))
              if key == "education" {
                let degree = str-of(entry, "degree")
                let area = str-of(entry, "area")
                if degree == "" { area }
                else if area == "" or lower(degree).contains(lower(area)) { degree }
                else { degree + " in " + area }
              } else if str-of(entry, "subtitle") != "" { [#entry.subtitle] }
            }
          ]
          #let intro = str-of(entry, "intro")
          #if key == "experience" and intro != "" { block(below: st.bulletGap, markup(intro)) }
          #if key == "experience" { bullets(entry) } else {
            let b = entry.at("bullets", default: ())
            if b.len() > 0 { list(..b.map(markup)) }
          }
        ]
        v(st.itemGap, weak: true)
      }
    ])
  } else if key == "awards" and items(key).len() > 0 {
    section(key, "Awards", [#for a in items(key) {
      let heading = (a.title, str-of(a, "subtitle")).filter(p => p != "").join(" - ")
      let label = (heading, str-of(a, "date")).filter(p => p != "").join(", ")
      block(above: 0pt, below: st.lineItemGap)[#text(weight: st.strongWeight, label + if a.bullets.len() > 0 and label != "" { ":" } else { "" })#if a.bullets.len() > 0 { [ #a.bullets.map(markup).join(" ")] }]
    }])
  } else if key == "customFields" and source.customFieldItems.len() > 0 {
    section(key, "Custom Fields", list(..source.customFieldItems.map(i => linked(i.text, str-of(i, "url")))))
  } else if key in ("languages", "interests") and items(key).len() > 0 {
    section(key, upper(key.slice(0, 1)) + key.slice(1), list(..items(key).map(i => if key == "languages" { [#i.language #str-of(i, "fluency")] } else { [#i.name: #i.keywords.join(", ")] })))
  }
}
#let layout = value(source, "navyLayout")
// Match the editor: all main sections, all sidebar sections, then defaults.
#let configured = if layout == none { order } else { layout.main + layout.sidebar }
#let reading-order = if "summary" in configured { configured } else { ("summary",) + configured }
#for key in default-order + order + ("customFields",) {
  if key not in reading-order { reading-order.push(key) }
}
#render-sections(reading-order)
