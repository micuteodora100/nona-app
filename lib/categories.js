// Task categories — default set, but fully user-customizable via Settings
// (stored as profile.categories). A task's `tag` field stores the category
// `id`, which stays stable across renames; only `label` is user-facing.
// `color` is the sticky-note background each category's tasks render on.
export const DEFAULT_CATEGORIES = [
  { id: "applications", label: "Applications", color: "#CFE0F3" },
  { id: "bills", label: "Bills & money", color: "#F6D1C9" },
  { id: "groceries", label: "Groceries & errands", color: "#D3E8D0" },
  { id: "family", label: "Family", color: "#E3D6F0" },
  { id: "health", label: "Health", color: "#CDEDE6" },
]

// Assigned to newly-added custom categories, one per creation, cycling
// once there are more custom categories than swatches.
const NOTE_PALETTE = ["#F6E7A8", "#CFE0F3", "#F6D1C9", "#D3E8D0", "#E3D6F0", "#CDEDE6", "#F3D9C4", "#DCE3C6"]

// Classic pale-yellow paper — used for tasks with no category, and as a
// fallback for any category saved before `color` existed.
const UNTAGGED_NOTE_COLOR = "#FBF3D9"

// Backfills `color` for categories saved before it existed (matches the
// original default by id where possible, otherwise a stable palette pick)
// so every category always has a real note color, never just the untagged fallback.
export function getCategories(profile) {
  const stored = profile?.categories?.length ? profile.categories : DEFAULT_CATEGORIES
  return stored.map((c, i) => {
    if (c.color) return c
    const original = DEFAULT_CATEGORIES.find(d => d.id === c.id)
    return { ...c, color: original?.color || NOTE_PALETTE[i % NOTE_PALETTE.length] }
  })
}

export function nextNoteColor(categories) {
  return NOTE_PALETTE[categories.length % NOTE_PALETTE.length]
}

export function noteColor(tag, categories) {
  if (!tag) return UNTAGGED_NOTE_COLOR
  return categories.find(c => c.id === tag)?.color || UNTAGGED_NOTE_COLOR
}

// Falls back to title-casing the raw id for tags left over from a category
// that was since renamed-away-from or deleted, so old tasks never just vanish.
export function categoryLabel(id, categories) {
  if (!id) return null
  return categories.find(c => c.id === id)?.label || (id.charAt(0).toUpperCase() + id.slice(1))
}

export function slugifyCategoryId(label, existingIds) {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "category"
  let id = base
  let n = 2
  while (existingIds.includes(id)) { id = `${base}-${n}`; n++ }
  return id
}
