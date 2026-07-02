// Supabase auth callback — handles OAuth redirects and magic link confirmations
export default async function handler(req, res) {
  // Supabase handles this via the client-side supabase.auth.onAuthStateChange
  // This route exists as a fallback redirect target
  res.redirect(302, "/")
}
