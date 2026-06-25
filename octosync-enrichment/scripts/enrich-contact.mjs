#!/usr/bin/env node

// Thin client for the approval-broker's POST /enrich/contact endpoint.
// The Prospecting Researcher calls this once per candidate company; the
// broker resolves a business phone (Google Places) + a named work email
// (Hunter), classified personal vs generic with a deliverability check.
//
// The Google Places + Hunter keys live in the broker's secrets bundle,
// NOT on this agent — this client only carries the broker bearer token.
//
// Usage:
//   enrich-contact.mjs --company-name "Acme" --region "Oregon" \
//     [--domain "acme.com"] [--person-name "Jane Doe"]
//
// Env vars (required):
//   EMAIL_APPROVAL_PUBLIC_URL     — broker base URL (e.g.
//                                    https://agents.octosync.dev/approvals).
//                                    The /approvals suffix is stripped so we
//                                    can hit /enrich/contact on the same host.
//   EMAIL_APPROVAL_INTERNAL_TOKEN — bearer token shared with the broker
//
// Prints the broker's JSON result to stdout: phone, phoneSource, website,
// domain, email, emailType (personal|generic), emailDeliverable,
// emailConfidence, name, role, sources, missing, notes.

function blocker(message) {
  const line = `BLOCKER: ${message}\n`;
  process.stderr.write(line);
  process.stdout.write(line);
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) blocker(`unexpected positional argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      blocker(`flag --${name} requires a value`);
    }
    flags[name] = value;
    i++;
  }
  return flags;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") {
    blocker(`missing required flag --${name}`);
  }
  return value;
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    blocker(`missing required env var: ${name}`);
  }
  return value;
}

// EMAIL_APPROVAL_PUBLIC_URL is conventionally ".../approvals"; the enrich
// route lives at "/enrich/contact" on the same host. Strip "/approvals"
// (or a trailing slash) so we can build the URL without a second env var.
function brokerRoot(publicUrl) {
  return publicUrl.replace(/\/+$/, "").replace(/\/approvals$/, "");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    process.stderr.write(
      "Usage: node enrich-contact.mjs --company-name <name> " +
        "[--region <region>] [--domain <domain>] [--person-name <name>]\n"
    );
    process.exit(2);
  }
  const flags = parseFlags(argv);
  const companyName = requireFlag(flags, "company-name");

  const publicUrl = requireEnv("EMAIL_APPROVAL_PUBLIC_URL");
  const token = requireEnv("EMAIL_APPROVAL_INTERNAL_TOKEN");

  const payload = {
    companyName,
    region: flags["region"] ?? "",
    domain: flags["domain"] ?? "",
    personName: flags["person-name"] ?? ""
  };

  const url = `${brokerRoot(publicUrl)}/enrich/contact`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    blocker(`broker request failed: ${err.message}`);
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const reason =
      (body && typeof body === "object" && body.error) ||
      (typeof body === "string" ? body.slice(0, 200) : `HTTP ${response.status}`);
    blocker(`broker rejected request: ${reason}`);
  }
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
}

main().catch((err) => {
  blocker(err instanceof Error ? err.message : String(err));
});
