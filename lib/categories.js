// Task categories — default set, but fully user-customizable via Settings
// (stored as profile.categories). A task's `tag` field stores the category
// `id`, which stays stable across renames; only `label` is user-facing.
export const DEFAULT_CATEGORIES = [
  { id: "applications", label: "Applications" },
  { id: "bills", label: "Bills & money" },
  { id: "groceries", label: "Groceries & errands" },
  { id: "family", label: "Family" },
  { id: "health", label: "Health" },
]

export function getCategories(profile) {
  return profile?.categories?.length ? profile.categories : DEFAULT_CATEGORIES
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
