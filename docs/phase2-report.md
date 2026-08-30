# Phase 2 (Reduced) Report — docs/phase2update.txt

Live AI caption/hashtag generation, real Marketing activity feed, and honest
"not connected" Publish behavior. **No Meta/WhatsApp credentials used.**

---

## 1. Files changed

**New (feature code):**
- `lib/ai/caption-generator.ts` — caption + hashtag generation via the existing
  OpenAI Agents SDK (`Agent` + `run()` + `createBusinessManagerModel()`). No
  separate AI call path. Language-aware (en/ur). Note: `temperature` was
  removed from `modelSettings` (OpenAI `gpt-5.6-luna` only supports the default
  temperature; the failover router treated `temperature: 0.6` as futile and no
  Gemini/Groq backup engaged — this was the critical root-cause fix).
- `lib/marketing/social-posts.ts` — service layer: `createDraftForProduct`
  (calls the caption generator, inserts a `social_posts` row with
  `status: "draft"`), `listSocialPosts` (joins product name via
  `products(name)`).
- `lib/marketing/types.ts` — added `isSocialPostPlatform()` helper.
- `lib/ai/tools/marketing-tools.ts` — controlled tool `generateProductCaptionTool`
  (Agent → Controlled Tool → Service → Supabase → Verified Result),
  registered in the `businessTools` index.
- `tests/qa/marketing-publish-phase2-verify.mjs` — live end-to-end QA test
  (real Chrome, real account, real AI provider, Roman Urdu).
- `tests/qa/cleanup-phase2.mjs` — cleanup of throwaway test products/posts.

**Modified (existing feature wiring):**
- `app/actions/products.ts` — `createProductAction` now calls
  `createDraftForProduct` after a successful product create (best-effort,
  wrapped in try/catch — product creation is never blocked).
- `app/actions/marketing.ts` — `listSocialPostsAction()` and
  `publishSocialPostAction(postId)` returning `{ ok: true, published: false,
  code: "not_connected" }` (never fakes a publish).
- `components/marketing/marketing-view.tsx` — real activity feed
  (`ActivityPostCard`: product name, caption preview, draft status, Publish
  button), empty-state fallback, and localized publish feedback message.
- `app/dashboard/marketing/page.tsx` — fetches `listSocialPosts()` in parallel
  with metrics, passes `initialPosts`/`postsLoadFailed`.
- `lib/i18n/dictionary.ts` — added en + ur marketing strings (draft status,
  publish buttons, not-connected message, activity load error).

---

## 2. Real generated caption (from the live test)

Test product: `Phase2 Test Kurta <timestamp>` (category **Kurtay**, price
**Rs 2,500**).

The draft post (`status: "draft"`, `platform: "instagram"`) was created with
this real AI-generated caption (hashtags appended to the caption end, since
`social_posts` has no `hashtags` column):

```
Phase2 Test Kurta ab Rs 2,500 mein maujood hai! Rozmarra pehnne ke liye simple aur stylish intikhab.

#Kurta #Kurtay #MensFashion #TraditionalWear #Fashion
```

(An earlier run generated a second variant:
`"Phase2 Test Kurta ab sirf Rs 2,500 mein hasil karein! Rozmarra aur khaas mauqon ke liye behtareen intekhab. #Kurta #Kurtay #MensFashion #PakistaniFashion #Fashion"` —
both are real, language-aware Roman Urdu output from the AI provider chain.)

---

## 3. Activity feed + Publish verification (Roman Urdu)

Live test (test language `ur`, account language `ur`) — all checks passed:

```
// After adding the product:
activity-feed:
  { productNameShown: true,
    captionPreviewShown: true,
    draftStatusUr: true,          // "Draft — Instagram/Facebook se abhi connect nahi hai"
    publishButton: true }

// After clicking Publish (1.5s wait):
publish-click:
  { notConnectedUr: true,         // honest localized not-connected message shown
    stillDraft: true }            // no "Published" text appeared

// Server-side confirmation (row was never faked):
row-not-faked: { statusAfterClick: "draft" }
```

Console errors: 0 · Page errors: 0

The feed renders each draft with the product name, the generated caption
preview (first 160 chars), the Roman Urdu "Draft — not yet connected" status,
and a **Publish** button. Clicking Publish shows the honest localized message
**"Instagram/Facebook account abhi connect nahi hua. Pehle Settings mein
connect karein."**, does **not** change the row to published, and does not
silently fail. Screenshots captured at:
`tests/qa/shots/phase2-activity-ur.png` and
`tests/qa/shots/phase2-publish-notconnected-ur.png`.

---

## 4. Static verification (typecheck / lint / build)

- `npx tsc --noEmit` → passes, no output (clean).
- `npx next lint` → `✔ No ESLint warnings or errors`.
- `npm run build` → `✓ Compiled successfully`, all 23 routes built, 0 static
  generation failures.

---

## 5. What remains blocked, and why

These features are intentionally **not built** (no fake/placeholder
credentials were added):

- **Real Instagram/Facebook OAuth connection** — requires
  `META_APP_ID` / `META_APP_SECRET`.
- **Real publishing to a live Instagram/Facebook/WhatsApp account** — requires
  the OAuth app **and**
  `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
  `WHATSAPP_BUSINESS_ACCOUNT_ID`.
- **Real WhatsApp notifications** — requires the same WhatsApp credentials.

In Marketing settings, the Connect buttons remain in their Phase-1 shell state
(no fake "connected" state). The Publish action is wired to an honest server
action that reports `code: "not_connected"` (no fake publish).

**To resume:** once the user has created the Meta app and provides
`META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_BUSINESS_ACCOUNT_ID`, this phase can
be extended to real OAuth + publishing without touching the caption generation
or the social_posts/AI architecture already in place.

---

## 6. No existing feature touched/broken

Product creation flow is unchanged from the user's perspective; the draft
hook is best-effort and non-blocking. Typecheck, lint, and build all pass,
confirming no regressions.
