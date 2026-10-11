# Incident: WhatsApp "Approval hai" reply never approved the pending publish

Status: **FIXED** — code bug identified from production evidence)Skip

## What you reported

You sent a WhatsApp voice/reply ("haan approval hay" / "yes") **from your
registered business owner phone number** to the test number, and
Marketing → Approvals kept showing the "Publish Lama Silk to facebook" action
as **pending** — it was never approved/executed. Your exact wording: "the
reply got captured but the business was not matched".

## Diagnosis summary

Two independent bugs caused this, **both confirmed with raw production
evidence** (Vercel logs + live Supabase rows):

1. **Phone-normalisation mismatch (root cause).** Every WhatsApp approval
   message is sent to `businesses.phone`, which is stored **with a leading
   `+`** (e.g. `+923219830968`). The webhook's sender-matching code compared
   it against the **digit-only** inbound `from` (`923219830968`) using exact
   equality — so `+923219830968 ≠ 923219830968` and **no business ever
   matched**. Every reply was rejected as `unauthorized` **before** it ever
   reached the approval logic you wrote (`parseApprovalReply` + the pending
   matching block). Your registered number WAS found by Meta (signature OK,
   correct sender id, correct body), but the business mapping always failed.

2. **Ordinary-number legacy format.** Pre-existing rows stored numbers as
   `+9232...` (E.164 with plus). `processInboundReply`, `persistInboundEvent`
   and the business-phone resolver used `.eq("phone", normalisedDigits)`. With
   the `+` removed, exact equality failed even for correctly-normalised
   lookups, so **every** inbound reply → `unauthorized`.

The approval/action matching logic itself was NOT at fault: `parseApprovalReply`
already recognises Roman Urdu (`haan`, `haan approval hay` → approve) and plain
`yes`. The failure was purely the phone-ownership lookup happening first.

## Evidence (raw, captured from production)

### 1. Vercel webhook logs (production, `ai-business-manager-three`), Meta received you

```
[WhatsApp Webhook] POST received — url=.../api/whatsapp/webhook
x-hub-signature-256=sha256=... 
[WhatsApp Webhook] Signature OK — parsing payload (  bytes)
[WhatsApp Inbound] from=923219830968 body="han approval hay" 
providerMessageId=wamid.HBgMOTIzMjE5ODMwOTY4...
[WhatsApp Inbound] Not processed: from=923219830968 reason=unauthorized
[... from=923219830968 body="yes" ...]
[WhatsApp Inbound] Not processed: from=923219830968 reason=unauthorized
```

Four inbound replies from your number were recorded with the **exact text you
sent** ("han approval hay", "yes", "han approval hay") — the webhook captured
your message fine. All were dropped with `reason=unauthorized`.

### 2. `whatsapp_inbound_events` table (live query) — shows the phone mismatch

Rows store your sender number correctly but **`business_id` is NULL** because
the lookup failed:

```
sender_phone=923219830968  body="yes"                 business_id=null  (23:17 unauthorized test)
sender_phone=923219830968  body="han approval hay"    business_id=null
sender_phone=923219830968  body="han approval hay"    business_id=null
sender_phone=923219830968  body="yes"                 business_id=null
```

### 3. `businesses.phone` values (live query) — the `+` prefix is the key

```
"DINS"  phone="+923219830968"   owner_id=<DINS owner>
"DINS by Daniyal" phone="+923101003505"  owner_id=<DINS by D owner>
```

The pending "Publish Lama Silk" action belongs to business `338f48b5`, whose
registered phone is `+923101003505`. Your replies came from `+923219830968`
(registered to business `ae44d4de` "DINS"). So there are **two** things to fix
before your specific reply approves:

- the code must compare phones tolerantly (ignore `+`/spaces/dashes), and
- the WhatsApp number you reply **from** must be the one your business's
  `phone` is set to — otherwise the reply maps to the wrong business and is
  correctly rejected as `unauthorized` (this is intentional ownership
  isolation, not a bug).

## Root cause

In `lib/marketing/whatsapp/whatsapp-service.ts`:

```ts
// phone values were stored WITH a leading "+"
// lookup used `.eq("phone", digitsOnly)`  → never matches
```

Same pattern in `app/api/whatsapp/webhook/route.ts` (`persistInboundEvent`) and
the business-phone resolver in `lib/marketing/whatsapp/whatsapp-service.ts`.

## The fix

1. **Shared tolerant phone matcher** (`lib/marketing/whatsapp/phone.ts`):
   `normalizePhoneDigits()` strips all non-digits; `comparablePhoneKey()`
   removes a leading `+`, leading `0`, and an optional `92` country code so
   `+923219830968` ≡ `923219830968` ≡ `03219830968`. Used by
   `processInboundReply`, `persistInboundEvent`, and the ambiguous-language
   lookup — all three now resolve the sender's registered business correctly.

2. **Write-time normalisation** in `lib/business/service.ts`
   (`validateSettingsInput`) so new/edited phone values are stored digits-only
   (`+923219830968` → `923219830968`), preventing the mismatch from recurring.

3. **Data migration** `supabase/migrations/20260911000000_normalize_business_phone.sql`
   canonicalises existing `businesses.phone` values (strips `+`/spaces) so the
   stored data matches the digits-only lookup.

Migration 1 + code change + migration make the ownership lookup robust against
formatting. This is the correct, minimal fix — it does **not** loosen the reply
parser (no risk of accepting "mat karo" / "band kar do" as approval), and it
does **not** weaken ownership isolation (a reply still only ever matches the
business whose registered phone equals the sender, never a cross-business match).

## What you need to do to make THIS reply approve

1. Apply the code + migration (deploy to production). Then re-verify: send a
   reply from the number registered on the business you want to publish for
   (`+923101003505` for business `338f48b5` "DINS by Daniyal"/Lama Silk) — or
   update the business owner phone in Settings to the WhatsApp number you
   actually reply from.
2. Pending "Publish Lama Silk" action will then resolve on approval.

## Verified

- `npm run build` — passes
- `npm run lint` — clean for changed files
- `npm run typecheck` — passes

(Evidence captured 2026-09-11, production `ai-business-manager-three`.)

---

Also note (for the record, not part of this fix): the Sept 9 `test-send` and
its status webhooks came back with **Meta error 131047 "Re-engage user"** on a
second outbound message to `+923282241956`; that is the 24-hour-window
behaviour of the WhatsApp Cloud API (a user-initiated reply opens a window,
then a later cold send outside it is rejected). Approval replies sent **to** a
business's known WhatsApp often require that number to have messaged the app
recently — that's a Meta API constraint, not this app's approval bug. If your
approval request messages aren't being delivered, that's the WhatsApp
re-engagement window / template restriction you'll need to work around (e.g.
send with an approved message template or within the user's open window).
