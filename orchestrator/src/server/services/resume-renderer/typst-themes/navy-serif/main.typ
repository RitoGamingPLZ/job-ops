// Self-contained: no package downloads or external assets are required.
#let source = json(__RESUME_DATA_PATH__)
#let value(item, key) = item.at(key, default: none)
#let str-of(item, key) = { let v = value(item, key); if v == none { "" } else { v } }
#let items(key) = source.at(key, default: ())
#let navy = rgb("#1f3a6e")
#let default-order = ("skills", "certifications", "experience", "projects", "education", "awards", "languages", "interests", "publications", "volunteer", "references")
#let order = if source.at("defaultSectionOrder", default: false) or value(source, "sectionOrder") == none { default-order } else { source.sectionOrder }
#let titles = source.at("sectionTitles", default: (:))
#let title(key, fallback) = {
  let t = titles.at(key, default: fallback)
  if key == "experience" and t == "Experience" { "Experiences" }
  else if key == "skills" and t == "Technical Skills" { "Skills" }
  else { t }
}
#set page(paper: __PAGE_PAPER__, margin: (x: 12mm, y: 10mm))
#set text(font: ("Times New Roman", "Liberation Serif", "TeX Gyre Termes", "Libertinus Serif"), size: 10.5pt, lang: "en", top-edge: "ascender", bottom-edge: "descender")
// Leading is added to the font's ascender/descender height, not the font size.
#let body-leading = 0.3em
#set par(leading: body-leading, spacing: 3pt)
// List spacing replaces leading: retain it, then add the gap between items.
#set list(marker: [●], indent: 3pt, body-indent: 12pt, tight: false, spacing: body-leading + 1.5pt)
#show link: it => text(fill: rgb("#1155cc"), underline(it))
#let linked(label, url) = if url == "" { label } else { link(url, label) }
#let accent(body) = text(fill: navy, weight: "bold", style: "italic", size: 11pt, body)
#let section(key, fallback, body) = if body != [] {
  block(above: 10pt, below: 0pt, sticky: true)[
    #text(fill: navy, weight: "bold", size: 14pt)[#strong[#title(key, fallback)]]
    #v(3pt)
    #line(length: 100%, stroke: (paint: navy, thickness: 1.2pt))
    #v(4pt)
  ]
  body
}
// Bullets/summary are escaped by convertDocFieldsToTypst; other fields are plain strings.
#let markup(s) = eval(s, mode: "markup")
#let bullets(entry) = {
  let b = entry.at("listBullets", default: entry.at("bullets", default: ()))
  if b.len() > 0 { list(..b.map(markup)) }
}
#let row(left, right) = grid(columns: (1fr, auto), column-gutter: 1em, left, right)
#align(center)[
  #text(fill: navy, weight: "bold", size: 20pt, upper(source.name))
  #v(2pt)
  #text(size: 10pt)[
    #let contacts = source.contactItems.map(c => {
      let prefix = if str-of(c, "kind") == "phone" { "Tel: " } else if str-of(c, "kind") == "email" { "Email: " } else { "" }
      [#prefix#linked(c.text, str-of(c, "url"))]
    })
    #if str-of(source, "location") != "" { contacts.push(source.location) }
    #for p in source.profileItems { contacts.push(linked(p.network, str-of(p, "url"))) }
    #contacts.join([ | ])
  ]
  #if str-of(source, "headline") != "" { [\ #text(size: 10pt, source.headline)] }
]
#if str-of(source, "summary") != "" { section("summary", "Summary", markup(source.summary)) }
#for key in order {
  if key == "skills" and items("skillGroups").len() > 0 {
    section(key, "Skills", list(..items("skillGroups").map(g => [#text(fill: navy, weight: "bold")[#g.name:] #g.keywords.join(", ")])))
  } else if key == "certifications" and items(key).len() > 0 {
    section(key, "Certifications", grid(columns: (1fr, 1fr), column-gutter: 12pt, row-gutter: 5pt, ..items(key).map(c => list([#linked(c.title, str-of(c, "url"))#if str-of(c, "date") != "" { [#(" - " + c.date)] }]))))
  } else if key in ("experience", "education", "projects", "volunteer", "publications", "references") and items(key).len() > 0 {
    section(key, upper(key.slice(0, 1)) + key.slice(1), [
      #for entry in items(key) {
        block(above: 0pt, below: 9pt)[
          #block(sticky: true, below: 2pt)[
            #if key == "experience" {
              let position = str-of(entry, "position")
              accent(if position != "" { position } else { str-of(entry, "subtitle") })
              linebreak()
              let location = str-of(entry, "location")
              row(accent(entry.title + if location != "" { " - " + location } else { "" }), accent(str-of(entry, "date")))
            } else {
              let label = if key == "projects" { underline(linked(entry.title, str-of(entry, "url"))) } else { entry.title }
              row(accent(label), accent(str-of(entry, "date")))
              if str-of(entry, "subtitle") != "" { [#entry.subtitle] }
            }
          ]
          #let intro = str-of(entry, "intro")
          #if key == "experience" and intro != "" { [#markup(intro) #parbreak()] }
          #if key == "experience" { bullets(entry) } else {
            let b = entry.at("bullets", default: ())
            if b.len() > 0 { list(..b.map(markup)) }
          }
        ]
      }
    ])
  } else if key == "awards" and items(key).len() > 0 {
    section(key, "Awards", list(..items(key).map(a => [#a.title#if a.bullets.len() > 0 { [: #a.bullets.map(markup).join(" ")] }])))
  } else if key in ("languages", "interests") and items(key).len() > 0 {
    section(key, upper(key.slice(0, 1)) + key.slice(1), list(..items(key).map(i => if key == "languages" { [#i.language #str-of(i, "fluency")] } else { [#i.name: #i.keywords.join(", ")] })))
  }
}
#if source.customFieldItems.len() > 0 { section("customFields", "Custom Fields", list(..source.customFieldItems.map(i => linked(i.text, str-of(i, "url"))))) }
