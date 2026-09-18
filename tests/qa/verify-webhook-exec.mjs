// QA: verify the WhatsApp-reply approval now EXECUTES past the auth barrier.
// Replicates the exact failing scenario (owner replies "Yes" via WhatsApp →
// processInboundReply claims a pending action and runs its executor) using a
// FAKE postId so no real publish can happen. Pass means the executor runs and
// returns a real business result (post-not-found) instead of "You are not
// signed in.".
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const businessId = "338f48b5-74ed-4f0b-8754-208c6fe663b5";
const ownerId = "f2110bbf-30bb-4a64-bd48-7516de122e61";
const ts = Date.now();
const idempotencyKey = `qa-webhook-exec-${ts}`;
const externalRef = `qa-ref-${ts}`;
const fakePostId = `qa-notfound-${ts}`;
const providerMessageId = `wamid.QA-${ts}`;

const adminHeaders = {
  apikey: serviceKey,
  Authorization: "Bearer " + serviceKey,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
const admin = async (path, init) => {
  const res = await fetch(url + "/rest/v1/" + path, {
    ...init,
    headers: { ...adminHeaders, ...((init && init.headers) || {}) },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`admin ${path} -> ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
};

const { processInboundReply } = await import("@/lib/marketing/whatsapp/whatsapp-service");

let actionId = null;
try {
  // 1. Seed a pending approval for the real business with a fake post target.
  const [created] = await admin("approval_actions", {
    method: "POST",
    body: JSON.stringify({
      business_id: businessId,
      user_id: ownerId,
      action_type: "publish_social_post",
      action_payload: { postId: fakePostId, platform: "facebook" },
      summary: "QA webhook execution test — no real publish.",
      approval_mode: "needs_approval",
      status: "pending",
      idempotency_key: idempotencyKey,
      external_reference: externalRef,
    }),
  });
  actionId = created.id;
  console.log("seeded pending action:", actionId, "ref:", externalRef);

  // 2. Simulate the owner's WhatsApp "Yes" reply (same code the webhook runs).
  const result = await processInboundReply({
    from: "923282241956",
    body: "Yes",
    providerMessageId,
  });
  console.log("REPLY RESULT:", JSON.stringify(result));

  // 3. Read back the final state.
  const [finalRow] = await admin(`approval_actions?id=eq.${actionId}`);
  console.log("FINAL ACTION:", JSON.stringify(finalRow, null, 2));

  const err = finalRow?.execution_error ?? "";
  if (!result.ok || result.data?.decision !== "approve") {
    console.error("PASS FAILED: reply did not approve.");
    process.exit(1);
  }
  if (/not signed in/i.test(err) || /not configured/i.test(err)) {
    console.error("STILL BLOCKED BY SESSION BARRIER:", err);
    process.exit(1);
  }
  if (finalRow?.status === "failed" && /could not be found|not be found/i.test(err)) {
    console.log("PASS: executor ran past auth, real business result:", err);
  } else if (finalRow?.status === "completed") {
    console.log("PASS: executed (unexpected but valid — post was found).");
  } else {
    console.error("UNEXPECTED OUTCOME:", finalRow?.status, err);
    process.exit(1);
  }
} finally {
  // Cleanup: remove test rows.
  try {
    const eRes = await fetch(
      url + "/rest/v1/approval_events?approval_action_id=eq." + actionId,
      { method: "DELETE", headers: adminHeaders },
    );
    await eRes.text();
  } catch (e) { console.error("cleanup events:", e.message); }
  if (actionId) {
    try {
      await admin(`approval_actions?id=eq.${actionId}`, { method: "DELETE" });
      console.log("cleaned up action:", actionId);
    } catch (e) { console.error("cleanup action:", e.message); }
  }
}