-- Run this in your Supabase SQL Editor.
-- Adds access-token caching to oauth_tokens so the email API routes can fetch
-- a live Google/Microsoft access token server-side instead of embedding it in
-- the NextAuth session cookie. Embedding both providers' tokens in that
-- cookie is what overflowed the browser's 4KB cookie limit and caused
-- "connecting one provider disconnects the other."

ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
