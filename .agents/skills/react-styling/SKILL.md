---
name: react-styling
description:
  How React components are laid out and styled. Layout follows Mark Dalgleish's
  approach from SEEK's Braid design system; components never provide
  surrounding white space, and layout components (Box, Stack, Inline, Columns,
  Spread, Tiles, ContentBlock, PageBlock, Bleed) own spacing and placement.
  Appearance is context-aware; components read CSS custom properties with
  fallbacks, and the regions around them supply values through inheritance
  instead of location selectors. Use when writing, reviewing, or refactoring
  React components or their CSS, adding space between elements, placing a
  component somewhere new, theming a page region, or adding design tokens.
  Triggers on margin, gap, spacing, line-height, vertical rhythm, borders
  shifting layout, positioning, z-index, responsive layout, CSS custom
  properties, design tokens, theming, dark regions, and "make X look different
  inside Y".
---

# React Component Styling

A component owns its inside. Its context owns everything else, through two
channels:

- **Placement**, through layout components. A component never provides
  surrounding white space; the layout component that renders it decides where
  it sits and how much space surrounds it.
- **Area-level appearance**, through inherited CSS custom properties. A
  component defines how values affect its look; the region around it supplies
  the values.

Neither channel uses selectors that reach into another component. In short:
**never position yourself; always position your children. Consume values;
don't ask where you are.**

## When to Apply

- Writing a component or its styles
- Adding space between elements
- Placing a component somewhere new and it "doesn't fit"
- Making a component look different in one area of the page
- Adding design tokens, themes, or dark regions
- Reviewing CSS or `className` changes
- Fixing doubled, missing, or collapsing space, or text that won't line up

## Layout

Based on Mark Dalgleish on
[Full Stack Radio 134, "You Should Be Using Layout Components"](https://fullstackradio.com/134),
and the layout model of SEEK's
[Braid design system](https://seek-oss.github.io/braid-design-system/foundations/layout):

> Components should not provide surrounding white space. Spacing between
> elements is owned entirely by layout components.

A component styles everything inside its own box and nothing outside it. Where
the box sits, the space around it, and its size relative to its siblings are
decided by the component that renders it. Every component is both a child and
a parent, so the rule holds at every level.

This matches how designers work. They specify the space between things in a
group, as design tools do with auto layout, not margins on the things. A layout
component is that group in code. Components then drop into any context without
overrides, and each space is defined in exactly one place.

### 1. Components provide no surrounding white space

Whatever the styling approach (CSS, CSS modules, Tailwind, inline `style`), the
root element of a content component never sets:

| Concern               | Forbidden on the root                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Outer spacing         | `margin` in any direction, including `margin-left: auto` push tricks                             |
| Self-placement        | `position: absolute/fixed/sticky` with offsets, `inset`, `z-index`, `float`, placing `transform` |
| Placement in a parent | `align-self`, `justify-self`, `place-self`, `order`, `grid-area`, `grid-column`, `grid-row`      |
| Size set by context   | `flex`, `flex-grow/shrink/basis`, `%`/`vw`/`vh` sizes, a fixed width chosen to fit one container |

The root may set anything about its inside: `padding`, `border` (rule 9),
`background`, `border-radius`, its own `display` and the internal layout that
creates, `position: relative` to anchor its own absolute children, and
intrinsic sizes (rule 4).

**Incorrect (the card decides where it sits):**

```css
.exercise-card {
  margin-bottom: 16px;
  padding: 16px;
}
.exercise-card:last-child {
  margin-bottom: 0;
}
```

**Correct (the card styles its inside; a Stack owns the spacing):**

```css
.exercise-card {
  padding: var(--space-gutter);
}
```

```tsx
<Stack space="medium">
  {exercises.map((e) => (
    <ExerciseCard key={e.id} exercise={e} />
  ))}
</Stack>
```

### 2. A text element's box ends at the text

Browsers include `line-height` in a text element's height. A 16px font with
`line-height: 1.5` gets 4px of half-leading above the first line and below the
last, on top of the font's own space above cap height. That hidden white space
makes a `small` gap between a heading and a paragraph render noticeably larger,
and text never sits on the spacing grid.

Text components trim their box to cap height and baseline. The space between
wrapped lines stays:

```css
.text {
  text-box: trim-both cap alphabetic;
}
```

`text-box` works in current Chrome, Edge, Safari, and Firefox. To support older
browsers, use [Capsize](https://seek-oss.github.io/capsize/) from SEEK, which
computes the same trim from font metrics using negative margins on
`::before`/`::after`.

### 3. Layout components own the space between siblings

Space between siblings comes from `gap` on a layout component such as `Stack`
or `Inline`. Don't space siblings with margins on the children, spacer
elements, `<br>`, or `:first-child`/`:last-child` resets.

Margin on one side of each child fails in predictable ways:

- `margin-bottom` on every child leaves stray space after the last one, and a
  `:last-child` reset breaks when the last child is conditionally rendered.
- `* + *` or `margin-top` on non-first children still matches after a
  `display: none` sibling, leaving space at the top of the group.
- Margins collapse with the parent's and neighbors' margins, so the rendered
  space depends on context.
- A component with a built-in margin needs an override everywhere that wants
  different spacing.

`gap` puts space only between rendered items, nothing at the edges, and never
collapses. CSS adding `gap` to flexbox, with the spacing set on the parent,
confirms the layout-component model.

Dividers between items belong to the layout component (a `dividers` option on
`Stack`), not to `border-bottom` on each child plus a `:last-child` reset. To
push two groups to opposite ends (title left, actions right), use `Spread`. The
child doesn't put `margin-left: auto` on itself.

### 4. Intrinsic size belongs to the component, extrinsic size to the parent

- **Intrinsic** is true wherever the component goes: an icon is 20×20, an
  avatar is 40px round, a chart has `aspect-ratio: 16 / 9`, an input has a
  `min-inline-size` below which it's unusable. The component sets these.
- **Extrinsic** depends on placement: take a third of the row, fill the
  remaining space, cap at 640px on this page. The parent sets these, through
  `Columns`/`Column` widths, `Tiles`, or a `ContentBlock`.

A block-level root already fills its container. Don't add `width: 100%`.

### 5. A parent never reaches into a child

A parent may target its own slots (`.toolbar > *`, or a wrapper element it
owns) to place them. It may not style a child component's internals.

```css
/* Incorrect: the day view restyles the card's title */
.day .exercise-card .title {
  font-size: 20px;
}
```

A parent influences a child in exactly three ways: placement, by wrapping it in
layout components; area-level appearance, by setting the child's public custom
properties on itself (rule 16); and meaning, through an explicit variant prop
the child implements (rule 20).

### 6. Place children by wrapping them, not through props

Content components don't accept `className`, `style`, `margin`, `align`, or
`fullWidth` props for placement. A passthrough `className` makes every rule
above optional. When a parent needs a child placed, it wraps the child in a
layout component.

**Incorrect (the child exposes knobs for its own placement):**

```tsx
<SetRow set={set} className="mt-2" />
<SaveButton fullWidth alignRight />
```

**Correct (layout components place it):**

```tsx
<Stack space="small">
  <SetRow set={set} />
</Stack>
<Spread space="small">
  <DayTitle day={day} />
  <SaveButton />
</Spread>
```

### 7. Keep layout components separate from content components

- **Layout components** arrange children. They hold no content, data, or
  behavior, and they own every spacing value.
- **Content components** render data and behavior and assume nothing about
  where they'll be placed.

Braid's set covers most layouts:

| Component      | Job                                                     | Core CSS                                                                 |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Box`          | renders one element with padding from the scale         | `padding`                                                                |
| `Stack`        | vertical list with even space, optional dividers        | `display: flex; flex-direction: column; gap`                             |
| `Inline`       | row with even space that wraps onto new lines           | `display: flex; flex-wrap: wrap; gap`                                    |
| `Columns`      | side-by-side columns, width set per `Column`            | `display: flex; gap`; each `Column` sets its own `flex`                  |
| `Spread`       | two groups at opposite ends with a minimum space        | `display: flex; justify-content: space-between; gap`                     |
| `Tiles`        | grid of equal tiles                                     | `display: grid; grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); gap` |
| `ContentBlock` | caps width and centers horizontally                     | `max-inline-size: var(--width); margin-inline: auto`                     |
| `PageBlock`    | responsive page gutters around a `ContentBlock`         | `padding-inline: var(--space-gutter)`                                    |
| `Bleed`        | lets content extend into the parent's padding           | negative `margin` equal to the parent's padding token                    |

```tsx
import type { CSSProperties, ReactNode } from "react";

type Space = "xxsmall" | "xsmall" | "small" | "medium" | "large" | "xlarge";

export function Stack({ space, children }: { space: Space; children: ReactNode }) {
  return (
    <div className="stack" style={{ "--_stack-space": `var(--space-${space})` } as CSSProperties}>
      {children}
    </div>
  );
}
```

```css
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--_stack-space);
}
```

`space` is required, so every group states its spacing. Add a layout component
when a layout repeats, not ahead of time. Layout that appears once can live in
the parent's own CSS as long as it follows rules 1–5. If a layout component
renders a `<ul>` with `list-style: none`, add `role="list"`, because Safari
drops list semantics otherwise.

### 8. Spacing comes from a scale on a grid

Every gap and padding uses a named token, never a raw pixel value. Braid's
scale runs `none`, `xxsmall` … `xxxlarge`, plus `gutter` for component insets
and page gutters. Layout components accept only scale names, so an off-scale
value is a type error.

Make every step a multiple of one base grid unit (e.g. 4px). With text trimmed
(rule 2) and borders taking no space (rule 9), everything lands on that grid,
which keeps vertical rhythm.

Spacing shows grouping. Use tighter space inside a group than between groups:
an outer `Stack space="large"` between sections, an inner
`Stack space="xsmall"` between a label and its input.

### 9. Borders take no space

A 1px border adds 2px to a box and knocks everything after it off the grid.
Draw borders so they don't affect layout:

```css
.exercise-card {
  box-shadow: inset 0 0 0 1px var(--line);
}
```

Dividers get the same treatment: a zero-height element that draws its line
with a pseudo-element or shadow, so adding dividers doesn't shift anything.

### 10. Responsiveness lives in layout components

Content components contain no media queries. Breakpoint decisions go in layout
components as responsive values, so each one sits in the component that owns
that layout:

```tsx
<Columns space="medium" collapseBelow="tablet">…</Columns>
<Stack space={{ mobile: "small", tablet: "large" }}>…</Stack>
```

Prefer intrinsic responsiveness (`Inline` wrapping, `clamp()`) when it's
enough. Container queries let a layout component respond to its own slot
instead of the viewport. `container-type: inline-size` stops that element from
sizing to its content, so use it only on elements that fill their slot.

### 11. Overlays escape through the top layer, not z-index

- Inside a component, absolute positioning against its own root is fine: the
  root is `position: relative`, the badge is `position: absolute`.
- Menus, popovers, dialogs, and toasts that must escape their parent go in the
  top layer (`<dialog>` with `showModal()`, the `popover` attribute) or
  through a portal. Prefer the top layer: it keeps the element's DOM ancestry,
  so it still inherits its region's custom properties (rule 19).
- When `z-index` is unavoidable, use a few named tokens (`--z-sticky`,
  `--z-overlay`) set by the page or shell, never `9999`.

### 12. Page structure is layout too

A `Page` keeps the footer at the bottom of short pages (a
`min-block-size: 100dvh` grid with a `1fr` main row). A `PageBlock` sets the
responsive page gutters around a `ContentBlock`, which caps the width. The
shell also owns sticky headers, scroll containers, and safe-area padding
(`env(safe-area-inset-*)`). Feature components render into a region and fill
it.

## Context-Aware Styling

A component's visual decisions come from CSS custom properties, not hard-coded
values. The component defines how those values affect its appearance. A
surrounding region sets or overrides the values, and the component picks them
up through inheritance. The same button can be solid in the main content and
outlined in the header without knowing it's inside a header: the header
provides values, the button consumes them.

Tokens come in layers:

| Layer          | Example                               | Set on                                | Read by                         |
| -------------- | ------------------------------------- | ------------------------------------- | ------------------------------- |
| Primitive      | `--color-blue-700`                    | `:root`                               | semantic tokens and regions     |
| Semantic       | `--action-bg`, `--surface`, `--text`  | `:root`, theme wrappers, regions      | component fallbacks             |
| Component hook | `--button-bg`, `--button-fg`          | regions needing a component tweak     | the component's private alias   |
| Private alias  | `--_button-bg`                        | the component's own root              | the component's declarations    |

```css
:root {
  --color-blue-700: #174ea6;
  --color-white: #fff;

  --action-bg: var(--color-blue-700);
  --action-fg: var(--color-white);
}

.button {
  /* Public hooks: --button-bg, --button-fg, --button-border */
  --_button-bg: var(--button-bg, var(--action-bg));
  --_button-fg: var(--button-fg, var(--action-fg));
  --_button-border: var(--button-border, var(--_button-bg));

  background: var(--_button-bg);
  color: var(--_button-fg);
  border: 1px solid var(--_button-border);
  border-radius: 0.35rem;
  padding: 0.65em 1em;
}

/* Regions supply values; buttons inside pick them up */
.site-header {
  --button-bg: transparent;
  --button-fg: var(--color-white);
  --button-border: currentColor;
}
```

### 13. Hooks are for values that vary, not for structure

The component owns its layout, typography, internal spacing, borders, and
focus, hover, and disabled states. Only values that should change by context
become hooks; not every declaration becomes a variable. Hooks never carry
surrounding space or placement, which stay with layout components (rules 1–6).

Before adding a hook, check whether `currentColor` or `inherit` already does
the job. An icon with `fill: currentColor` matches the text around it with no
API at all.

### 14. Expose a small, documented API

- Public hooks (`--button-bg`, `--button-fg`, `--button-border`) are the
  component's styling API. List them with their defaults in a comment at the
  top of the component's CSS.
- Private aliases (`--_button-bg`) resolve each hook to its default. Nothing
  outside the component sets them.
- Derive state colors from the hooks instead of adding a hook per state:
  `background: color-mix(in oklab, var(--_button-bg), black 12%)` on hover.
- Don't register public hooks with `@property` and an `initial-value`. The
  initial value replaces the `var()` fallback, and `inherits: false` would
  block context entirely.

### 15. Name tokens by role, not appearance

Prefer `--action-bg`, `--surface`, and `--text-muted` over `--blue`. Primitive
tokens such as `--color-blue-700` sit underneath semantic ones. Component
fallbacks resolve to semantic tokens, never to primitives or raw values, so a
theme that changes a role changes every component that plays it.

### 16. Set defaults broadly, override near the context

Put site-wide defaults on `:root` or a theme wrapper. Set local differences on
the smallest region that needs them. Never couple a component's styling to its
location with selectors like `.site-header .button`. The component opts in to
its hooks; the container provides values.

```css
/* Incorrect: the button's look depends on a selector about where it is */
.site-header .button {
  background: transparent;
}

/* Correct: the header supplies a value; the button consumes it */
.site-header {
  --button-bg: transparent;
}
```

### 17. Override at the right level

Override semantic tokens when a whole region should change consistently.
Override component hooks when the region needs one component adjusted. A dark
header redefines `--surface`, `--text`, and `--action-bg` and sets
`color-scheme: dark` so form controls and scrollbars follow. It doesn't set
`--button-bg`, `--input-bg`, `--link-fg`, and twenty more.

### 18. Render sensibly with no context

Every hook falls back, through its private alias, to a semantic default defined
on `:root`. A component rendered outside any region still looks right.

### 19. Inheritance follows the DOM tree

Values flow from ancestors to descendants, and a declaration on the element
itself beats an inherited one. So never set a default on a public hook in the
component's own rule; it silently overrides every context.

```css
/* Incorrect: the header's --button-bg never reaches the button */
.button {
  --button-bg: var(--action-bg);
  background: var(--button-bg);
}

/* Correct: the default lives in the fallback */
.button {
  --_button-bg: var(--button-bg, var(--action-bg));
  background: var(--_button-bg);
}
```

The DOM tree decides, not the React tree. A menu portaled to `body` loses its
region's values. A `<dialog>` or `popover` element rendered inside the region
keeps them.

### 20. Use variants for meaning, context for area treatment

Context tokens suit shared themes and area-level treatment. When a difference
communicates intent, use an explicit variant (`<Button tone="critical">`)
instead of relying on a container to imply it. Meaning usually outranks the
area, so the variant sets the private alias directly and ignores the region's
hook:

```css
.button[data-tone="critical"] {
  --_button-bg: var(--critical-bg);
  --_button-fg: var(--on-critical);
}
```

### 21. Test nested and exceptional cases

Check each component:

- in nested regions (a light panel inside a dark header)
- in regions it wasn't designed for, and in no region at all
- in focus, hover, and disabled states in every context, with text and focus
  ring contrast checked against each context's surface (read the ring color
  from a semantic `--focus-ring` so dark regions can swap it)
- for leaks: a region's values reach every descendant, including components
  nested deep inside it that shouldn't change

## Foundations

- `*, *::before, *::after { box-sizing: border-box; }` keeps declared sizes
  honest.
- Reset user-agent margins on `body`, `h1`–`h6`, `p`, `ul`, `ol`, `figure`, and
  `blockquote`. Those default margins are surrounding white space that no
  component asked for.
- Use logical properties (`padding-inline`, `margin-block`, `inset-inline-start`,
  `inline-size`) so layouts survive RTL.
- A flex or grid child won't shrink below its content's width, which breaks
  text truncation. The parent fixes this on the slot with `min-width: 0` or a
  `minmax(0, 1fr)` track.

## Exceptions

- Global resets and the document root (`html`, `body`, `#root`).
- Layout components set layout on their children and may place themselves:
  `ContentBlock` centers itself with `margin-inline: auto`, and `Bleed` uses
  negative margins. Negative margins appear nowhere else.
- Third-party components that ship their own margins or hard-coded colors: wrap
  each one in a single adapter component that neutralizes margins and maps
  tokens at the boundary. Don't scatter overrides.

## Existing Code

When a change touches a component that breaks these rules, fix the parts the
change touches. Don't sweep unrelated components in the same diff.

## Review Checklist

Layout:

- [ ] No `margin`, offsets, `z-index`, `align-self`/`justify-self`, `order`,
      grid placement, or `flex` sizing on any content component's root
- [ ] Siblings are spaced by `gap` in a layout component
- [ ] Text elements are trimmed to cap height and baseline
- [ ] Borders and dividers take no layout space
- [ ] Dividers come from the layout component, not borders on children
- [ ] No `className`, `style`, or placement props on content components
- [ ] All spacing comes from scale tokens
- [ ] No media queries in content components
- [ ] Negative margins only through `Bleed`; no `:first-child`/`:last-child`
      margin resets

Styling:

- [ ] No selectors reach into another component or style it by location
- [ ] Public hooks are few and documented; private aliases use `--_`
- [ ] Defaults live in fallbacks, never on a public hook in the component's own
      rule
- [ ] Component fallbacks read semantic tokens, not primitives or raw values
- [ ] Regions override semantic tokens for broad changes and hooks only for
      specific tweaks
- [ ] Meaningful differences use explicit variants
- [ ] Checked in nested regions, with no region, in every state, and for
      contrast

## References

Layout:

- Mark Dalgleish on Full Stack Radio 134, "You Should Be Using Layout
  Components": https://fullstackradio.com/134
- Mark Dalgleish, "Rethinking Design Best Practices" (ReactiveConf 2019):
  https://www.youtube.com/watch?v=jnV1u67_yVg
- Braid layout foundations:
  https://seek-oss.github.io/braid-design-system/foundations/layout
- Capsize: https://seek-oss.github.io/capsize/
- MDN, `text-box`: https://developer.mozilla.org/en-US/docs/Web/CSS/text-box
- Heydon Pickering and Andy Bell, _Every Layout_: https://every-layout.dev
- Max Stoiber, "Margin considered harmful": https://mxstbr.com/thoughts/margin

Context-aware styling:

- Philip Walton, "Why I'm Excited About Native CSS Variables" (the
  button-in-a-header example):
  https://philipwalton.com/articles/why-im-excited-about-native-css-variables/
- Lea Verou, "CSS Variable Secrets" (CSS Day 2022):
  https://www.youtube.com/watch?v=ZuZizqDF4q8, slides at
  https://projects.verou.me/talks/css-variables/
- Lea Verou, "Dynamic CSS Secrets":
  https://projects.verou.me/talks/dynamic-css-secrets/
- MDN, "Using CSS custom properties":
  https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties
- MDN, `@property`: https://developer.mozilla.org/en-US/docs/Web/CSS/@property
- W3C, CSS Custom Properties for Cascading Variables Level 1:
  https://www.w3.org/TR/css-variables-1/
