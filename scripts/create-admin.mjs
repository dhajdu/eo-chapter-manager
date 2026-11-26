#!/usr/bin/env node
// Makes someone a super admin and prints a one-time link for them to set a
// password. Run once for the first admin; afterwards add people in /admin.
//
//   node --env-file=.env.local scripts/create-admin.mjs you@yourchapter.org "Your Name"
//
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SITE_URL in .env.local.
import { createClient } from "@supabase/supabase-js";

const [email, ...nameParts] = process.argv.slice(2);
const fullName = nameParts.join(" ").trim();
if (!email || !email.includes("@") || !fullName) {
  console.error('Usage: node --env-file=.env.local scripts/create-admin.mjs <email> "<Full Name>"');
  process.exit(2);
}
const { SUPABASE_URL, SUPABASE_SECRET_KEY, NEXT_PUBLIC_SITE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const normalized = email.trim().toLowerCase();

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (hit || data.users.length < 200) return hit ?? null;
  }
  return null;
}

let user = await findUser();
if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  user = data.user;
  console.log(`Created sign-in for ${normalized}`);
} else {
  console.log(`Sign-in already exists for ${normalized}`);
}

const { data: existing, error: readErr } = await supabase.from("user_profiles").select("id").eq("user_id", user.id).maybeSingle();
if (readErr) throw readErr;
const profile = { user_id: user.id, email: normalized, full_name: fullName, role: "super_admin", active: true };
const { error: writeErr } = existing
  ? await supabase.from("user_profiles").update(profile).eq("id", existing.id)
  : await supabase.from("user_profiles").insert(profile);
if (writeErr) throw writeErr;
console.log("Role set to super admin");

const siteUrl = (NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({ type: "recovery", email: normalized, options: { redirectTo: `${siteUrl}/reset-password` } });
if (linkErr) throw linkErr;
// Go through our own /auth/confirm route, as invitations do (src/lib/invite-link.ts):
// it verifies the token server-side and sets the session cookies. Supabase's own
// action_link puts the session in the URL hash, which the PKCE browser client
// ignores, so /reset-password would always say "Link expired".
const q = new URLSearchParams({ token_hash: link.properties.hashed_token, type: "recovery", next: "/reset-password" });
console.log("\nGive this one-time link to the admin to set their password (it expires in 24 hours):");
console.log(`${siteUrl}/auth/confirm?${q.toString()}`);
