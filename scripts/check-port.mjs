#!/usr/bin/env node
// Iva port preflight check — thin CLI wrapper over scripts/lib/ports.mjs.
//
//   node scripts/check-port.mjs            # IVA_PORT from .env (or 8723)
//   node scripts/check-port.mjs 8723       # specific port
//   node scripts/check-port.mjs --suggest  # suggest the nearest free one
//   node scripts/check-port.mjs --json
//
// Exit code: 0 — free, 1 — occupied, 2 — usage error.

import { defaultChecker, PortSelector, readIvaPort } from "./lib/ports.mjs";

// Reporter: output formatting is decoupled from the check logic (SRP).
const reporter = {
  human({ port, occupied, holders }, suggestion) {
    if (!occupied) return `✓ Port ${port} is free.`;
    const who = holders.length ? `\n  held by → ${holders.join("; ")}` : "";
    const sug = suggestion ? `\n  free alternative → ${suggestion}` : "";
    return `✗ Port ${port} is occupied.${who}${sug}`;
  },
  json: (result, suggestion) => JSON.stringify({ ...result, suggestion }, null, 2),
};

async function main(argv) {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const suggest = args.includes("--suggest");
  const portArg = args.find((a) => /^\d+$/.test(a));
  const port = portArg ? Number(portArg) : readIvaPort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${port}`);
    process.exit(2);
  }

  const checker = defaultChecker();
  const result = await checker.check(port);

  let suggestion = null;
  if (suggest || result.occupied) {
    suggestion = await new PortSelector(checker).firstFree(result.occupied ? port + 1 : port);
  }

  console.log(asJson ? reporter.json(result, suggestion) : reporter.human(result, suggestion));
  process.exit(result.occupied ? 1 : 0);
}

main(process.argv).catch((e) => {
  console.error(e?.message || String(e));
  process.exit(2);
});
