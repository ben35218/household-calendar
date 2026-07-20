#!/usr/bin/env node
// Spec-sync gate for spec-driven development (see specs/README.md → "The change loop").
//
// Maps changed code paths to the spec that owns them and reports any area whose
// code changed without its spec being updated in the same change set. This is a
// nudge toward "spec first, ship together" — not a hard blocker.
//
// Usage:
//   node scripts/check-spec-sync.mjs                 # working tree (staged + unstaged) vs HEAD
//   node scripts/check-spec-sync.mjs --base main     # current branch vs merge-base with <base>
//   node scripts/check-spec-sync.mjs --strict        # exit 1 on drift (for CI / hooks that block)
//
// Exit codes: 0 = in sync (or drift without --strict), 1 = drift with --strict, 2 = usage/git error.

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const baseIdx = args.indexOf('--base');
const base = baseIdx !== -1 ? args[baseIdx + 1] : null;

// Ordered rules: first matching pattern wins per file. `specs` lists the spec
// files that must be touched when a matching code file changes.
const RULES = [
  // Cross-cutting foundations — check these before the per-feature rules.
  { re: /^shared\/crypto\//, specs: ['specs/platform/crypto-e2ee.md'] },
  { re: /^server\/src\/models\/(Record|encFields)\.js/, specs: ['specs/platform/data-model.md'] },
  { re: /^server\/src\/services\/(householdKey|keyEnvelope|e2eePolicy|securityAlerts)\.js/, specs: ['specs/platform/crypto-e2ee.md'] },
  { re: /^mobile\/src\/lib\/e2ee\.ts/, specs: ['specs/platform/crypto-e2ee.md'] },

  // Features.
  { re: /^(server\/src\/routes\/(auth|authPasskey)\.js|mobile\/src\/screens\/auth\/|mobile\/src\/store\/auth\.tsx|mobile\/src\/lib\/(passkeys|secureToken|deviceLink|deviceKey)\.ts)/, specs: ['specs/features/auth-identity.md'] },
  { re: /^(server\/src\/routes\/(household|keys)\.js|mobile\/src\/screens\/profile\/HouseholdScreen\.tsx|mobile\/src\/lib\/safetyNumbers\.ts)/, specs: ['specs/features/households-sharing.md'] },
  { re: /^(server\/src\/routes\/(calendars|calendarChat|eventAttachments|invitations)\.js|mobile\/src\/screens\/calendar\/|mobile\/src\/lib\/(calendar|calendarData|eventRepeat|calendarKeys|holidays)\.ts|shared\/calendar\/)/, specs: ['specs/features/calendar.md'] },
  { re: /^(server\/src\/routes\/(recipes|recipeSchedule)\.js|mobile\/src\/screens\/kitchen\/|mobile\/src\/lib\/grocery)/, specs: ['specs/features/kitchen.md'] },
  { re: /^(server\/src\/routes\/(items|tasks|chores|odometer|manuals|taskTemplates|choreTemplates)\.js|mobile\/src\/screens\/maintenance\/|server\/src\/services\/recurrence\.js|shared\/seed\/)/, specs: ['specs/features/maintenance.md'] },
  { re: /^(server\/src\/routes\/(trips|tripsChat)\.js|mobile\/src\/screens\/trips\/|mobile\/src\/lib\/tripKeys\.ts|server\/src\/services\/tripSharing\.js)/, specs: ['specs/features/trips.md'] },
  { re: /^(server\/src\/routes\/people\.js|mobile\/src\/screens\/profile\/(People|Person|ContactImport))/, specs: ['specs/features/people-contacts.md'] },
  { re: /^(server\/src\/routes\/(calendarChat|choresChat|maintenanceChat|maintenancePlanChat|tripsChat|calls|formAssist)\.js|server\/src\/services\/(chatStream|chatSuggestions|aiUsage|phoneCalls)\.js|mobile\/src\/screens\/chat\/|mobile\/src\/lib\/aiPayload\.ts)/, specs: ['specs/features/ai-assistant.md'] },
  { re: /^(server\/src\/routes\/(billing|monetizationConfig)\.js|mobile\/src\/screens\/plan\/|mobile\/src\/lib\/purchases\.ts|admin\/)/, specs: ['specs/features/billing-plans.md'] },
  { re: /^(server\/src\/routes\/notifications\.js|server\/src\/jobs\/scheduler\.js|server\/src\/services\/(push|notify)\.js|mobile\/src\/lib\/(notifications|push)\.ts)/, specs: ['specs/features/notifications.md'] },

  // Broad fallbacks — a route or model with no more-specific owner still owns the platform specs.
  { re: /^server\/src\/routes\//, specs: ['specs/platform/api-reference.md'] },
  { re: /^server\/src\/models\//, specs: ['specs/platform/data-model.md'] },
];

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error(`git ${cmd} failed: ${err.message}`);
    process.exit(2);
  }
}

let changed;
if (base) {
  const mb = git(`merge-base HEAD ${base}`);
  changed = git(`diff --name-only ${mb} HEAD`);
} else {
  // Working tree: staged + unstaged vs HEAD, plus untracked.
  const tracked = git('diff --name-only HEAD');
  const untracked = git('ls-files --others --exclude-standard');
  changed = [tracked, untracked].filter(Boolean).join('\n');
}

const files = changed.split('\n').map((f) => f.trim()).filter(Boolean);
if (files.length === 0) {
  console.log('spec-sync: no changes to check.');
  process.exit(0);
}

const touchedSpecs = new Set(files.filter((f) => f.startsWith('specs/')));
const requiredByArea = new Map(); // spec path -> Set of code files that triggered it

for (const file of files) {
  if (file.startsWith('specs/')) continue;
  const rule = RULES.find((r) => r.re.test(file));
  if (!rule) continue;
  for (const spec of rule.specs) {
    if (!requiredByArea.has(spec)) requiredByArea.set(spec, new Set());
    requiredByArea.get(spec).add(file);
  }
}

const drift = [...requiredByArea.entries()].filter(([spec]) => !touchedSpecs.has(spec));

if (drift.length === 0) {
  console.log('spec-sync: OK — every changed code area has a matching spec update.');
  process.exit(0);
}

console.log('\nspec-sync: possible drift — code changed without its spec:\n');
for (const [spec, codeFiles] of drift) {
  console.log(`  ${spec}`);
  for (const f of codeFiles) console.log(`    ← ${f}`);
}
console.log('\nUpdate the spec(s) above (and bump last-verified), or note in the PR');
console.log('that this change does not alter documented behavior. See specs/README.md.\n');

process.exit(strict ? 1 : 0);
