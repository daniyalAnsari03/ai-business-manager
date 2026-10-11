/**
 * RLS write probe for the WhatsApp tables (docs/fix.txt).
 *
 * Answers one question: with nothing but the public anon key, can a caller
 * write to whatsapp_inbound_events / whatsapp_message_status /
 * whatsapp_message_id_map?
 *
 * Roles:
 *   - every PROBE uses the ANON key only, sent as `apikey` with no
 *     Authorization header so PostgREST resolves the request as the `anon`
 *     role. No key is ever printed.
 *   - the service-role key is used ONLY to seed, control-check and reap one
 *     sentinel whatsapp_message_status row.
 *
 * Two subtleties this script is built around (both verified against the live
 * project -- do not "simplify" them away):
 *
 * 1. Probes MUST use `Prefer: return=minimal`. With `return=representation`
 *    PostgREST evaluates the table's SELECT policy against the RETURNING list,
 *    so a *successfully inserted* row that anon cannot SELECT is reported as
 *    "42501 new row violates row-level security policy". That reads as "safe"
 *    when it is in fact the vulnerability. Verified: the same INSERT returns
 *    42501 under return=representation and 23503 (reached the FK check, i.e.
 *    RLS let it through) under return=minimal.
 *
 * 2. The UPDATE probe cannot trust the status code. A PATCH that matches zero
 *    rows and a PATCH that modified a row both return 204 under
 *    return=minimal, and 42501 is never raised for UPDATE. The only reliable
 *    oracle is to read the row back. A service-role control run proves the
 *    read-back path detects a real mutation before the anon probe is trusted.
 *
 * Run:
 *   node --env-file=.env.local tests/qa/whatsapp-write-policy-probe.mjs
 *
 * Exit 0 = every anon write probe was rejected (RLS enforced).
 * Exit 1 = at least one anon write probe was ACCEPTED (RLS bypassed).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(2);
}

const stamp = Date.now();
const SENTINEL_MESSAGE_ID = `wamid.RLSPROBE.${stamp}`;

// Well-formed UUID that can never exist in public.businesses. The FK check is
// an AFTER-row trigger, evaluated only AFTER the RLS WITH CHECK, so:
//   - if RLS let the row through  -> the FK fires with 23503 (RLS BYPASSED)
//   - if RLS blocked the row      -> 42501 (RLS BLOCKED)
// Either way the statement aborts, so the INSERT probes can never persist junk.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const anonHeaders = {
  apikey: anonKey,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

const adminHeaders = {
  apikey: serviceKey,
  Authorization: "Bearer " + serviceKey,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function post(table, headers, body) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.text()).slice(0, 220) };
}

async function patch(table, headers, messageId, body) {
  const res = await fetch(`${url}/rest/v1/${table}?message_id=eq.${messageId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.text()).slice(0, 220) };
}

async function readStatus(messageId) {
  const res = await fetch(
    `${url}/rest/v1/whatsapp_message_status?message_id=eq.${messageId}&select=status`,
    { headers: adminHeaders },
  );
  if (!res.ok) return `readback failed ${res.status}`;
  const [row] = await res.json();
  return row?.status ?? "row-missing";
}

// ---------------------------------------------------------------------------
// Seed + prove the harness can detect a real mutation before trusting the probe.
// ---------------------------------------------------------------------------

const bizRes = await fetch(`${url}/rest/v1/businesses?select=id&limit=1`, {
  headers: adminHeaders,
});
if (!bizRes.ok) {
  console.error(`business lookup failed ${bizRes.status}: ${(await bizRes.text()).slice(0, 200)}`);
  process.exit(2);
}
const [business] = await bizRes.json();
if (!business) {
  console.error("No business rows found; cannot seed the sentinel status row.");
  process.exit(2);
}

const seed = await post("whatsapp_message_status", adminHeaders, {
  business_id: business.id,
  message_id: SENTINEL_MESSAGE_ID,
  recipient_phone: "000000000000",
  status: "sent",
});
if (seed.status !== 201) {
  console.error(
    `Could not seed sentinel status row (HTTP ${seed.status}): ${seed.body}\n` +
      "A service-role key that can insert into whatsapp_message_status is required.",
  );
  process.exit(2);
}
console.log(`[probe] seeded sentinel whatsapp_message_status row (business ${business.id})`);

const results = [];

try {
  // Control: service role mutates the sentinel, read-back must observe it.
  await patch("whatsapp_message_status", adminHeaders, SENTINEL_MESSAGE_ID, {
    status: "delivered",
  });
  const controlStatus = await readStatus(SENTINEL_MESSAGE_ID);
  if (controlStatus !== "delivered") {
    console.error(
      `HARNESS BROKEN: service-role control update did not register (read back "${controlStatus}").\n` +
        "The anon UPDATE probe would be meaningless -- fix the harness first.",
    );
    process.exit(2);
  }
  await patch("whatsapp_message_status", adminHeaders, SENTINEL_MESSAGE_ID, { status: "sent" });
  const resetStatus = await readStatus(SENTINEL_MESSAGE_ID);
  if (resetStatus !== "sent") {
    console.error(`HARNESS BROKEN: could not reset sentinel to "sent" (got "${resetStatus}").`);
    process.exit(2);
  }
  console.log("[probe] control OK: harness can detect a real row mutation\n");

  // --- INSERT probes (anon) -----------------------------------------------
  const insertProbes = [
    [
      "whatsapp_inbound_events",
      {
        business_id: NIL_UUID,
        sender_phone: "000000000000",
        body: "rls write probe",
        provider_message_id: `wamid.RLSPROBE.${stamp}.inbound`,
      },
    ],
    [
      "whatsapp_message_status",
      {
        business_id: NIL_UUID,
        message_id: `wamid.RLSPROBE.${stamp}.status`,
        recipient_phone: "000000000000",
        status: "sent",
      },
    ],
    [
      "whatsapp_message_id_map",
      {
        business_id: NIL_UUID,
        provider_message_id: `wamid.RLSPROBE.${stamp}.map`,
        recipient_phone: "000000000000",
      },
    ],
  ];

  for (const [table, row] of insertProbes) {
    const res = await post(table, anonHeaders, row);
    let verdict;
    if (res.status === 42501 || /row-level security/i.test(res.body)) {
      verdict = { blocked: true, verdict: "RLS BLOCKED (42501)" };
    } else if (res.status === 23503 || /foreign key/i.test(res.body)) {
      verdict = {
        blocked: false,
        verdict: "RLS BYPASSED - row passed the RLS check and reached the FK check (23503); not persisted",
      };
    } else if (res.status === 23514 || /check constraint/i.test(res.body)) {
      verdict = {
        blocked: false,
        verdict: "RLS BYPASSED - row passed the RLS check and reached the CHECK constraint (23514); not persisted",
      };
    } else if (res.status === 200 || res.status === 201) {
      verdict = { blocked: false, verdict: "RLS BYPASSED - row was ACCEPTED and persisted" };
    } else {
      verdict = {
        blocked: false,
        verdict: `RLS BYPASSED - unexpected status ${res.status}`,
      };
    }
    results.push({ table, op: "INSERT (anon)", ...verdict, http: res.status, body: res.body });
  }

  // --- UPDATE probe (anon) on the seeded sentinel row ----------------------
  const upd = await patch("whatsapp_message_status", anonHeaders, SENTINEL_MESSAGE_ID, {
    status: "read",
  });
  const after = await readStatus(SENTINEL_MESSAGE_ID);
  const mutated = after === "read";
  results.push({
    table: "whatsapp_message_status",
    op: "UPDATE (anon)",
    http: upd.status,
    body: upd.body ? upd.body : "(empty)",
    ...(mutated
      ? { blocked: false, verdict: 'RLS BYPASSED - sentinel status is now "read"' }
      : {
          blocked: true,
          verdict: `RLS BLOCKED - sentinel status unchanged ("${after}")`,
        }),
  });
} finally {
  const del = await fetch(
    `${url}/rest/v1/whatsapp_message_status?message_id=eq.${SENTINEL_MESSAGE_ID}`,
    { method: "DELETE", headers: adminHeaders },
  );
  console.log(
    `\n[probe] cleaned up sentinel row: HTTP ${del.status} ${del.status < 300 ? "OK" : (await del.text()).slice(0, 200)}`,
  );
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const bypassed = results.filter((r) => !r.blocked);

console.log("\n=== ANON WRITE PROBE RESULTS ===");
for (const r of results) {
  console.log(`\n-- ${r.table} : ${r.op} --`);
  console.log(`  HTTP ${r.http}`);
  console.log(`  ${r.verdict}`);
  console.log(`  body: ${r.body}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`probes run     : ${results.length}`);
console.log(`blocked by RLS : ${results.length - bypassed.length}`);
console.log(`bypassed RLS   : ${bypassed.length}`);

if (bypassed.length > 0) {
  console.log(
    "\nRESULT: anon writes are ACCEPTED - the permissive `with check (true)` / `using (true)`\n" +
      "        policies are still live. Apply the migration to close this.",
  );
  process.exit(1);
}

console.log(
  "\nRESULT: every anon write probe was rejected by RLS - these tables are\n" +
    "        service-role write only. No probe row was persisted.",
);
process.exit(0);
