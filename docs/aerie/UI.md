# Panel UI structure (reference study)

Studied from PerchDeck's **public** website demo (https://www.perchdeck.app, 2026-11-04). No code or
assets were extracted from the app; this note describes layout patterns only. Aerie implements its own
version in Material 3 (Pixel) style, not a copy of their visual design.

## What their panel does

**Overall shape.** A wide card (roughly 2:1, about 520 x 280 logical px at medium size) hanging from
the notch. Three zones, top to bottom:

1. **Header** (about 36 px): app mark at left, then the tool's title. Tools with sub-views show them as
   large text tabs in the header ("History | Stack") instead of a separate segmented control.
   Tool actions sit at the right edge (clear, pin, more).
2. **Body**: the tool's content. Recurring layouts:
   - **Card grid** (Clipboard history, Shelf): 2 or 3 columns of fixed-height cards, grouped under
     small all-caps day headers with a count chip ("TODAY 10"). Card = preview on top, footer row
     with type icon + source app on the left and type label + age on the right. Hover reveals
     pin / more / close on the card's top-right corner.
   - **Main + side card** (Stack, Shelf, To-do): a narrow card on one side for the "primary action"
     (Stack: "Up next" preview + big Paste button with its shortcut; Shelf: "Share to nearby devices"
     drop tile; To-do: a summary with due/overdue/upcoming counts and the global shortcut shown as
     keycaps), and the list or grid beside it.
   - **Toolbar row** under the header: search field (pill) + filter chips on the right (All, Text,
     Links, Images, Files), or Collect toggle + progress + "Paste all" menu.
   - **Empty states**: centred icon in a soft square, one-line title, one helpful sentence.
   - **Toasts**: a small pill just above the dock ("Copied 3 as a row · press Ctrl+V to paste").
3. **Dock** (about 32 px): one row of icon-only buttons, one per tool, centred, with a divider before
   Settings. The active tool's icon sits in a rounded highlight. This replaces a tab strip with labels,
   which is why 13+ tools fit.

**Behaviour notes from the demo**: switching tools keeps the panel size fixed (no reflow); quick-entry
chips under inputs (Today, Tomorrow, Every weekday); keyboard shortcuts are shown inline as keycaps.

## How Aerie adapts it

| Their pattern | Aerie version |
|---|---|
| Icon dock at the bottom | **Bottom dock** in Material style: icon buttons, active one in a `secondary-container` pill, label in a tooltip; a divider before Settings. Replaces the top tab strip in Material theme. Glass theme keeps PILLAR's strip. |
| Header with tool title + sub-view tabs + actions | Shared `ToolHeader` component: title (Roboto Flex, medium), optional sub-view tabs, trailing icon actions. Tools stop drawing their own segmented controls. |
| Card grid with day groups | Clipboard history in a 2-column card grid (images get real thumbnails), `TODAY · n` group labels. |
| Main + side card | Stack ("Up next" + Paste button), Shelf (drop / send-to-phone tile), To-do summary card. |
| Toast above the dock | Shared toast pill, used by every tool instead of per-tab status text. |
| Wider panel | Panel widened toward 2:1 to fit grid + side card. |
| Share to nearby devices | Aerie's equivalent is **Send to phone** (phone link), plus optionally the Windows share sheet later. |

Order: dock + header + toast (shared shell) first, then Clipboard grid, Stack/Shelf/To-do side cards.
