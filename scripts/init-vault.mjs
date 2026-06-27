// Initialize the LIVE memory vault from the template.
//
//   node scripts/init-vault.mjs
//
// The live vault (ASSISTANT_VAULT_DIR, default ./vault) is a SEPARATE private git repo:
// personal transcripts/blobs/cards must NOT land in the code repository. This script
// copies the structure from vault-template/ (if the live vault is empty) and git-inits it.
// Idempotent: an existing vault with data is not overwritten.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const VAULT = resolve(process.env.ASSISTANT_VAULT_DIR ?? "vault");
const TEMPLATE = resolve("vault-template");

if (!existsSync(TEMPLATE)) {
  console.error(`init-vault: template ${TEMPLATE} not found (run from the project root)`);
  process.exit(1);
}

function isEmpty(dir) {
  if (!existsSync(dir)) return true;
  // Treat a vault as empty if it has no content (only .git is allowed).
  return readdirSync(dir).every((name) => name === ".git");
}

mkdirSync(VAULT, { recursive: true });

if (isEmpty(VAULT)) {
  // Copy the skeleton (rules, autograph, dbrain-processor, schema.json, empty directories).
  cpSync(TEMPLATE, VAULT, { recursive: true });

  // Pick the memory core language by AGENT_LANGUAGE: en → CORE.en.md overwrites CORE.md.
  // The seed CORE.en.md is removed from the live vault either way — leaving a single CORE.md.
  const lang = (process.env.AGENT_LANGUAGE ?? "ru").toLowerCase();
  const coreEn = resolve(VAULT, "CORE.en.md");
  if (existsSync(coreEn)) {
    if (lang === "en") cpSync(coreEn, resolve(VAULT, "CORE.md"));
    rmSync(coreEn);
  }

  console.log(`init-vault: vault created from template → ${VAULT} (CORE: ${lang})`);
} else {
  console.log(`init-vault: vault already has data, skipping template copy → ${VAULT}`);
}

// The live vault is its own git repo (backup + Obsidian). doctor.ts then commits/pushes.
if (!existsSync(resolve(VAULT, ".git"))) {
  execFileSync("git", ["-C", VAULT, "init", "-q"]);
  execFileSync("git", ["-C", VAULT, "add", "-A"]);
  try {
    execFileSync("git", ["-C", VAULT, "commit", "-q", "-m", "chore: init memory vault from template"]);
  } catch {
    // No git identity — not critical: doctor.ts will commit later.
    console.warn("init-vault: first commit failed (configure git user.name/email) — continuing");
  }
  console.log("init-vault: vault git repo initialized.");
  console.log(
    "Attach a private remote for backup:\n" +
      "  gh auth login\n" +
      `  gh repo create <user>/iva-vault --private --source="${VAULT}" --remote=origin --push`,
  );
} else {
  console.log("init-vault: vault git repo already exists — skipping init.");
}
