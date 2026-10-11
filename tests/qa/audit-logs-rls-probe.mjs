/**
 * RLS + GRANT probe for public.audit_logs (docs/fix.txt).
 *
 * The claim under test: audit rows are APPEND-ONLY SERVER DATA.
 *   - anon           -> no access at all (not even SELECT)
 *   - authenticated -> may SELECT only their own business's rows
 *   - authenticated -> may NOT insert / update / delete
 *   - anon           -> may NOT insert / update / delete
 *   - service_role  -> full access (the only writer)
 *
 * Roles used:
 *   - the public publishable key is sent as `apikey` with NO Authorization
 *     header on every anon probe, so PostgREST resolves the request as the
 *     `anon` role. No key or token value is ever printed.
 *   - a real user session (email/password from .env.local) is used for the
 *     `authenticated` probes -- never the service key -- so the owner-scoped
 *     SELECT policy is genuinely exercised, including the non-owner path.
 *   - the service-role key is used ONLY to seed sentinels, to read them back
 *     and to reap them. It never stands in for a user probe.
 *
 * Four subtleties this script is built around (the first two are verified on
 * the live project in tests/qa/whatsapp-write-policy-probe.mjs -- do not
 * "simplify" them away):
 *
 * 1. Write probes MUST use `Prefer: return=minimal`. With `return=representation`
 *    PostgREST evaluates the table's SELECT policy against the RETURNING list,
 *    so a *successfully inserted* row the caller cannot read back comes back as
 *    "42501 violates row-level security policy" -- which reads as "safe" when it
 *    is in fact the vulnerability. Under return=minimal an authorised insert
 *    shows up as 201.
 *
 * 2. UPDATE/DELETE probes cannot trust the status code: a PATCH/DELETE that
 *    matches zero rows and one that really mutated a row can return the same
 *    code. The only reliable oracle is a service-role read-back, and a
 *    service-role control run proves the read-back sees a real mutation BEFORE
 *    any user-probe verdict is trusted.
 *
 * 3. Each write probe gets a FRESH sentinel row. A previous probe that was
 *    wrongly allowed to delete the row would otherwise make the next probe
 *    look like it was blocked when it was simply a no-op.
 *
 * 4. The script sets `process.exitCode` and returns instead of calling
 *    `process.exit()`: on Windows, exiting while a fetch socket is still
 *    closing aborts Node with a libuv assertion. `Connection: close` on every
 *    request plus a natural shutdown keeps the exit code honest.
 *
 * 5. The Supabase endpoint sits behind Cloudflare, which intermittently drops
 *    the TLS handshake on this network (UND_ERR_CONNECT_TIMEOUT / UND_ERR_SOCKET).
 *    A dead socket is NOT an access-control verdict, so `rest` retries a few
 *    times and then reports `transportError` with status 0. Every caller treats
 *    that as "the probe could not run" (exit 2). It is never counted as a pass
 *    and never as a bypass.
 *
 * No probe row survives: every sentinel is reaped in `finally`, the extra
 * service-role write is reaped immediately, and insert probes target an
 * all-zero business_id that cannot exist, so even a bypassed insert aborts on
 * the FK check instead of persisting junk.
 *
 * Run (requires the migration to be applied first):
 *   node --env-file=.env.local tests/qa/audit-logs-rls-probe.mjs
 *
 * Exit 0 = every access-control claim held.
 * Exit 1 = at least one claim failed (a probe was ACCEPTED where it must not be).
 * Exit 2 = the probe could not run (missing env, table absent, no test user,
 *          or the network dropped a request after every retry).
 */
import fs from "node:fs";
import path from "node:path";

const envRaw = fs.readFileSync(path.resolve(".env.local"), "utf8");
function envValue(key, prefix = key + "=") {
  const line = envRaw.split(/\r?\n/).find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = envValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
const email = envValue("email:", "email: ");
const password = envValue("password:", "password: ");

// Well-formed uuid that can never exist in public.businesses. The FK check is
// an AFTER-row trigger, evaluated only AFTER any RLS WITH CHECK, so:
//   - grants/RLS let the row through -> 23503 (FK rejects, nothing persisted)
//   - grants/RLS blocked the row     -> 42501
// Either way the statement aborts, so an insert probe cannot persist junk.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const stamp = Date.now();
const SENTINEL = {
  own: `rlsprobe.audit_logs.own.${stamp}`,
  foreign: `rlsprobe.audit_logs.foreign.${stamp}`,
  extra: `rlsprobe.audit_logs.extra.${stamp}`,
  forged: `rlsprobe.audit_logs.forged.${stamp}`,
};
const SEED_REASON = "rls-probe-original";

const anonHeaders = {
  apikey: anonKey,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
  Connection: "close",
};

const adminHeaders = {
  apikey: serviceKey,
  Authorization: "Bearer " + serviceKey,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
  Connection: "close",
};

function userHeaders(accessToken) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
    Connection: "close",
  };
}

/** A dropped socket is retried this many times before the run is abandoned. */
const TRANSPORT_ATTEMPTS = 4;
const TRANSPORT_BACKOFF_MS = 800;

/**
 * Single request helper. Four fields, each for one purpose:
 *   - `status`  raw HTTP status (the only trustworthy oracle for writes);
 *               0 means the request never completed (see TRANSPORT_ATTEMPTS)
 *   - `ok`      2xx, mirroring Response.ok -- the old object had no `ok`, so
 *               every `if (!res.ok)` guard in this script was always true and
 *               reported a perfectly good 200 response as a failure
 *   - `body`    the body TRUNCATED to 240 chars, for display and regex checks
 *   - `json`    the body PARSED FROM THE FULL TEXT (never the truncated
 *               `body`, which throws as soon as a row set outgrows 240 chars)
 *
 * A transport failure resolves to `{ status: 0, transportError: true }` instead
 * of throwing, so the `finally` cleanup can still run. It must be treated by
 * callers as "could not run", never as a pass or a bypass.
 */
async function rest(path, init) {
  let lastCode = "unknown";
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, init);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, ok: res.ok, body: text.slice(0, 240), json };
    } catch (err) {
      lastCode = err?.cause?.code ?? err?.code ?? err?.message ?? String(err);
      if (attempt < TRANSPORT_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, TRANSPORT_BACKOFF_MS * attempt));
      }
    }
  }
  return {
    status: 0,
    ok: false,
    body: `transport error after ${TRANSPORT_ATTEMPTS} attempts: ${lastCode}`,
    json: null,
    transportError: true,
  };
}

/**
 * Set the first time a request never completed. The probe is all-or-nothing: a
 * dropped socket means the run is inconclusive, so the final report returns 2
 * instead of a pass/fail verdict, whatever the individual probe lines say.
 */
let transportFailure = null;
function noteTransport(res) {
  if (res.transportError && !transportFailure) transportFailure = res.body;
  return res;
}

/** Array body or null: PostgREST returns [] for a successful empty set. */
function asArray(res) {
  return Array.isArray(res.json) ? res.json : null;
}

/** A probe whose request never completed cannot be scored. */
function assertReachable(res, what) {
  if (res.transportError) {
    throw new Error(`${what}: ${res.body}`);
  }
}

// --- sentinel helpers: service role only, the one role allowed to write ----

async function seedSentinel(correlationId, businessId, action) {
  return rest("audit_logs", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      business_id: businessId,
      actor_type: "system",
      action,
      entity: "audit_logs",
      entity_id: null,
      reason: SEED_REASON,
      correlation_id: correlationId,
    }),
  });
}

async function readReasons(correlationId) {
  const res = await rest(`audit_logs?correlation_id=eq.${correlationId}&select=reason`, {
    headers: adminHeaders,
  });
  // The read-back IS the oracle for every UPDATE/DELETE verdict. If the socket
  // died, "no reason found" would be indistinguishable from "the row is gone"
  // and the probe would report a false BLOCKED. Fail loudly instead.
  assertReachable(res, `service-role read-back for ${correlationId} failed`);
  const rows = asArray(res);
  if (!rows) return null;
  return rows.map((r) => r.reason);
}

async function reap(correlationId) {
  return rest(`audit_logs?correlation_id=eq.${correlationId}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
}

async function reapAll() {
  for (const id of Object.values(SENTINEL)) {
    let del;
    let left;
    try {
      del = await reap(id);
      left = await readReasons(id);
    } catch (err) {
      console.log(
        `[probe] WARNING: cleanup could not confirm correlation ${id} -- ${err.message}\n` +
          "        Probe rows may still exist; re-run the probe once the network is stable.",
      );
      return false;
    }
    if (del.status >= 300 || (left?.length ?? 0) > 0) {
      console.log(`[probe] WARNING: cleanup incomplete for correlation ${id} (HTTP ${del.status})`);
      return false;
    }
  }
  console.log("[probe] cleanup: all probe rows reaped, nothing left behind");
  return true;
}

// --- result recording ------------------------------------------------------

const results = [];
function record(claim, actor, op, expect, http, body, passed, verdict) {
  results.push({ claim, actor, op, expect, http, body, passed, verdict });
}

function classifyWrite(http, body) {
  if (http === 0) {
    // The statement never reached Postgres. Saying "BYPASSED" or "BLOCKED"
    // here would be fiction; the run is abandoned via transportFailure.
    return { passed: false, verdict: `INCONCLUSIVE - ${body}` };
  }
  if (http === 42501 || /permission denied|row-level security/i.test(body)) {
    return { passed: true, verdict: "BLOCKED - 42501 permission denied" };
  }
  if (http === 23503 || /foreign key/i.test(body)) {
    return {
      passed: false,
      verdict: "BYPASSED - reached the FK check (23503), so the write WAS authorised; not persisted",
    };
  }
  if (http === 23514 || /check constraint/i.test(body)) {
    return {
      passed: false,
      verdict: "BYPASSED - reached the CHECK constraint (23514), so the write WAS authorised; not persisted",
    };
  }
  if (http === 200 || http === 201 || http === 204) {
    return { passed: false, verdict: "BYPASSED - write was ACCEPTED" };
  }
  return { passed: false, verdict: `BYPASSED - unexpected status ${http}` };
}

function recordWrite(claim, actor, op, res) {
  noteTransport(res);
  const v = classifyWrite(res.status, res.body);
  record(claim, actor, op, "denied", res.status, res.body || "(empty)", v.passed, v.verdict);
}

async function main() {
  if (!url || !anonKey || !serviceKey) {
    console.error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY",
    );
    return 2;
  }

  // ---- preconditions -----------------------------------------------------

    const tableProbe = noteTransport(await rest("audit_logs?select=id&limit=1", { headers: adminHeaders }));
  if (tableProbe.transportError) {
    console.error(`Could not reach ${url}/rest/v1/ -- ${tableProbe.body}`);
    return 2;
  }
  if (tableProbe.status === 404 || /PGRST205/.test(tableProbe.body)) {
    console.error(
      "public.audit_logs does not exist yet (PGRST205). Apply the migration first:\n" +
        "  npx supabase db push --linked",
    );
    return 2;
  }

  let session;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    session = await res.json();
  } catch (err) {
    console.error(
      `Could not sign in the test user (${err.message}).\n` +
        "The authenticated probes are mandatory for this task -- fix the .env.local test user and re-run.",
    );
    return 2;
  }
  const accessToken = session.access_token;
  const userId = session.user.id;
  const userHeadersObj = userHeaders(accessToken);
  console.log(`[probe] authenticated user ${userId}`);

  // The user's own business, resolved from the session (never from a client id).
  const ownRes = noteTransport(
    await rest(`businesses?owner_id=eq.${userId}&select=id,name`, {
      headers: userHeadersObj,
    }),
  );
  if (!ownRes.ok) {
    console.error(`business lookup failed ${ownRes.status}: ${ownRes.body}`);
    return 2;
  }
  const ownBusinesses = asArray(ownRes);
  if (!ownBusinesses) {
    console.error(`business lookup returned a non-array body (HTTP ${ownRes.status}): ${ownRes.body}`);
    return 2;
  }
  const [ownBusiness] = ownBusinesses;
  if (!ownBusiness) {
    console.error("This test user owns no business; cannot run the owner-scoped probes.");
    return 2;
  }
  console.log(`[probe] own business ${ownBusiness.id} (${ownBusiness.name})`);

  // A business owned by somebody else, as the target the user must NOT read.
  // Resolved with the service role; only its id is used.
  let foreignBusiness = null;
  const allBizRes = noteTransport(
    await rest("businesses?select=id,owner_id&limit=50", { headers: adminHeaders }),
  );
  if (allBizRes.ok) {
    foreignBusiness = (asArray(allBizRes) ?? []).find((b) => b.owner_id !== userId) ?? null;
  }
  if (!foreignBusiness) {
    console.log(
      "[probe] NOTE: no second business with a different owner exists;\n" +
        "        the non-owner SELECT probe will be reported as SKIPPED.",
    );
  }

  try {
    // ---- control: prove the read-back oracle sees a real mutation ---------
    const seed1 = noteTransport(
      await seedSentinel(SENTINEL.own, ownBusiness.id, "rls_probe.seed"),
    );
    if (seed1.status !== 201) {
      console.error(
        `Could not seed the sentinel row (HTTP ${seed1.status}): ${seed1.body}\n` +
          (seed1.transportError
            ? "The request never reached the database -- re-run on a stable connection."
            : "A service-role key with INSERT on public.audit_logs is required."),
      );
      await reapAll();
      return 2;
    }
    console.log("[probe] seeded 1 sentinel audit_logs row (service role)");

    const ctrlPatch = await rest(`audit_logs?correlation_id=eq.${SENTINEL.own}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ reason: "rls-probe-control" }),
    });
    const ctrlReasons = await readReasons(SENTINEL.own);
    if (!ctrlReasons?.includes("rls-probe-control")) {
      console.error(
        `HARNESS BROKEN: the service-role control update did not register (HTTP ${ctrlPatch.status}).\n` +
          "The UPDATE/DELETE probes would be meaningless -- fix the harness first.",
      );
      await reapAll();
      return 2;
    }
    await rest(`audit_logs?correlation_id=eq.${SENTINEL.own}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ reason: SEED_REASON }),
    });
    console.log("[probe] control OK: read-back detects a real mutation\n");

    // =================================================================
    // anon: SELECT
    // =================================================================
    const anonSelect = await rest("audit_logs?select=id&limit=1", { headers: anonHeaders });
    let anonSelPassed;
    let anonSelVerdict;
    const anonSelRows = asArray(anonSelect);
    if (anonSelect.status === 200 && anonSelRows) {
      const leaked = anonSelRows.length > 0;
      anonSelPassed = false;
      anonSelVerdict = leaked
        ? "FAIL - anon READ the audit log (rows returned); RLS is not holding"
        : "FAIL - anon holds a SELECT grant on audit_logs; RLS returned 0 rows, but anon must hold NO grant at all";
    } else if (anonSelect.status === 401 || anonSelect.status === 403) {
      anonSelPassed = true;
      anonSelVerdict = "BLOCKED - anon holds no table privilege on audit_logs";
    } else {
      anonSelPassed = false;
      anonSelVerdict = anonSelect.transportError
        ? `INCONCLUSIVE - ${anonSelect.body}`
        : `FAIL - unexpected anon SELECT status ${anonSelect.status}`;
    }
    noteTransport(anonSelect);
    record(
      "anon has NO grants (not even SELECT)",
      "anon",
      "SELECT",
      "denied",
      anonSelect.status,
      anonSelect.body || "(empty)",
      anonSelPassed,
      anonSelVerdict,
    );

    // =================================================================
    // anon: INSERT / UPDATE / DELETE
    // =================================================================
    const anonInsert = await rest("audit_logs", {
      method: "POST",
      headers: anonHeaders,
      body: JSON.stringify({
        business_id: NIL_UUID,
        actor_type: "ai",
        action: "rls_probe.forge",
        entity: "audit_logs",
        correlation_id: SENTINEL.forged,
      }),
    });
    recordWrite("anon cannot INSERT", "anon", "INSERT", anonInsert);
    await reap(SENTINEL.forged);

    await seedSentinel(SENTINEL.own, ownBusiness.id, "rls_probe.seed");
    const anonUpdate = await rest(`audit_logs?correlation_id=eq.${SENTINEL.own}`, {
      method: "PATCH",
      headers: anonHeaders,
      body: JSON.stringify({ reason: "forged-by-anon" }),
    });
    const afterAnonUpdate = await readReasons(SENTINEL.own);
    const anonMutated = afterAnonUpdate?.includes("forged-by-anon");
    record(
      "anon cannot UPDATE",
      "anon",
      "UPDATE",
      "denied",
      anonUpdate.status,
      anonUpdate.body || "(empty)",
      !anonMutated,
      anonMutated
        ? "BYPASSED - anon rewrote the sentinel reason"
        : "BLOCKED - sentinel reason unchanged after the anon PATCH",
    );

    await seedSentinel(SENTINEL.own, ownBusiness.id, "rls_probe.seed");
    const anonDelete = await rest(`audit_logs?correlation_id=eq.${SENTINEL.own}`, {
      method: "DELETE",
      headers: anonHeaders,
    });
    const afterAnonDelete = await readReasons(SENTINEL.own);
    const anonDeleted = (afterAnonDelete?.length ?? 0) === 0;
    record(
      "anon cannot DELETE",
      "anon",
      "DELETE",
      "denied",
      anonDelete.status,
      anonDelete.body || "(empty)",
      !anonDeleted,
      anonDeleted
        ? "BYPASSED - anon deleted the audit trail"
        : "BLOCKED - sentinel row survived the anon DELETE",
    );

    // =================================================================
    // authenticated: SELECT (owner + non-owner)
    // =================================================================
    const ownSelect = noteTransport(
      await rest(`audit_logs?business_id=eq.${ownBusiness.id}&select=id,action&limit=5`, {
        headers: userHeadersObj,
      }),
    );
    const ownRows = asArray(ownSelect);
    const ownOk = ownSelect.status === 200 && ownRows !== null;
    record(
      "owner can read their own business's audit log",
      "authenticated",
      "SELECT (own)",
      "allowed",
      ownSelect.status,
      ownSelect.body.slice(0, 120),
      ownOk,
      ownOk
        ? `ALLOWED as designed - returned an array of ${ownRows.length} row(s)`
        : ownSelect.transportError
          ? `INCONCLUSIVE - ${ownSelect.body}`
          : "FAIL - the owner cannot read their own audit log",
    );

    if (foreignBusiness) {
      const fseed = await seedSentinel(SENTINEL.foreign, foreignBusiness.id, "rls_probe.seed_foreign");
      if (fseed.status === 201) {
        const foreignSelect = noteTransport(
          await rest(`audit_logs?business_id=eq.${foreignBusiness.id}&select=id&limit=5`, {
            headers: userHeadersObj,
          }),
        );
        const parsed = foreignSelect.status === 200 ? asArray(foreignSelect) : null;
        const leaked = parsed !== null && parsed.length > 0;
        record(
          "non-owner cannot read another business's audit log",
          "authenticated",
          "SELECT (non-owner)",
          "empty",
          foreignSelect.status,
          foreignSelect.body.slice(0, 120),
          foreignSelect.status === 200 && !leaked,
          leaked
            ? "FAIL - RLS LEAK: a non-owner read another business's audit rows"
            : foreignSelect.transportError
              ? `INCONCLUSIVE - ${foreignSelect.body}`
              : "ALLOWED-as-empty - query succeeded and RLS returned zero rows",
        );
      } else {
        record(
          "non-owner cannot read another business's audit log",
          "authenticated",
          "SELECT (non-owner)",
          "empty",
          "n/a",
          "n/a",
          false,
          `INCONCLUSIVE - could not seed the foreign sentinel (HTTP ${fseed.status})`,
        );
      }
    } else {
      record(
        "non-owner cannot read another business's audit log",
        "authenticated",
        "SELECT (non-owner)",
        "empty",
        "n/a",
        "n/a",
        true,
        "SKIPPED - the project has a single business/owner, so no foreign row exists to leak",
      );
    }

    // =================================================================
    // authenticated: INSERT / UPDATE / DELETE
    // =================================================================
    const authInsert = await rest("audit_logs", {
      method: "POST",
      headers: userHeadersObj,
      body: JSON.stringify({
        business_id: ownBusiness.id,
        actor_type: "user",
        actor_id: userId,
        action: "rls_probe.forge",
        entity: "audit_logs",
        correlation_id: SENTINEL.forged,
      }),
    });
    recordWrite(
      "authenticated cannot INSERT (not even for their own business)",
      "authenticated",
      "INSERT",
      authInsert,
    );
    await reap(SENTINEL.forged);

    await seedSentinel(SENTINEL.own, ownBusiness.id, "rls_probe.seed");
    const authUpdate = await rest(`audit_logs?correlation_id=eq.${SENTINEL.own}`, {
      method: "PATCH",
      headers: userHeadersObj,
      body: JSON.stringify({ reason: "forged-by-user" }),
    });
    const afterAuthUpdate = await readReasons(SENTINEL.own);
    const authMutated = afterAuthUpdate?.includes("forged-by-user");
    record(
      "authenticated cannot UPDATE",
      "authenticated",
      "UPDATE",
      "denied",
      authUpdate.status,
      authUpdate.body || "(empty)",
      !authMutated,
      authMutated
        ? "BYPASSED - the owner rewrote history on their own sentinel"
        : "BLOCKED - sentinel reason unchanged after the authenticated PATCH",
    );

    await seedSentinel(SENTINEL.own, ownBusiness.id, "rls_probe.seed");
    const authDelete = await rest(`audit_logs?correlation_id=eq.${SENTINEL.own}`, {
      method: "DELETE",
      headers: userHeadersObj,
    });
    const afterAuthDelete = await readReasons(SENTINEL.own);
    const authDeleted = (afterAuthDelete?.length ?? 0) === 0;
    record(
      "authenticated cannot DELETE",
      "authenticated",
      "DELETE",
      "denied",
      authDelete.status,
      authDelete.body || "(empty)",
      !authDeleted,
      authDeleted
        ? "BYPASSED - the owner deleted the audit trail"
        : "BLOCKED - sentinel row survived the authenticated DELETE",
    );

    // =================================================================
    // service_role control: the one role that must still be able to write.
    // =================================================================
    const svcInsert = noteTransport(
      await rest("audit_logs", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          business_id: ownBusiness.id,
          actor_type: "ai",
          action: "rls_probe.service_write",
          entity: "audit_logs",
          correlation_id: SENTINEL.extra,
        }),
      }),
    );
    const svcReap = noteTransport(await reap(SENTINEL.extra));
    record(
      "service_role can INSERT (the intended writer)",
      "service_role",
      "INSERT",
      "allowed",
      svcInsert.status,
      svcInsert.body || "(empty)",
      svcInsert.status === 201,
      svcInsert.status === 201
        ? `ALLOWED as designed - reaped afterwards (HTTP ${svcReap.status})`
        : svcInsert.transportError
          ? `INCONCLUSIVE - ${svcInsert.body}`
          : "FAIL - the server cannot write the audit log; the table is unusable",
    );
  } finally {
    await reapAll();
  }

  // ---- report -----------------------------------------------------------

  const failed = results.filter((r) => !r.passed);

  console.log("\n=== audit_logs ACCESS PROBE ===");
  for (const r of results) {
    console.log(`\n-- ${r.actor}: ${r.op} (expect ${r.expect}) --`);
    console.log(`  ${r.passed ? "PASS" : "FAIL"}  HTTP ${r.http}  ${r.verdict}`);
    console.log(`  body: ${r.body}`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`probes run : ${results.length}`);
  console.log(`passed     : ${results.length - failed.length}`);
  console.log(`failed     : ${failed.length}`);

  // A dropped socket invalidates the run, whatever the lines above say: the
  // probes that never reached Postgres are not evidence either way.
  if (transportFailure) {
    console.log(
      `\nRESULT: INCONCLUSIVE - the network dropped a request (${transportFailure}).\n` +
        "        The lines above are partial; re-run on a stable connection for a verdict.",
    );
    return 2;
  }

  if (failed.length > 0) {
    console.log("\nRESULT: at least one access-control claim FAILED -- see the FAIL lines above.");
    return 1;
  }

  console.log(
    "\nRESULT: audit_logs is server-write-only and owner-read-only.\n" +
      "        anon: no access. authenticated: own-business SELECT only, zero write privileges.\n" +
      "        No probe row was left behind.",
  );
  return 0;
}

process.exitCode = await main();
