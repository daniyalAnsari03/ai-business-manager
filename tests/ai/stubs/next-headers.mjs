/**
 * Plain-Node stand-in for `next/headers` used ONLY by the offline/live AI
 * test loaders. Calling any of these outside a real Next.js request is a
 * test bug and fails loudly instead of silently misbehaving.
 */

function forbidden(name) {
  throw new Error(`next/headers:${name} called outside a Next.js request context`);
}

export const cookies = () => forbidden("cookies");
export const headers = () => forbidden("headers");
export const draftMode = () => forbidden("draftMode");

const nextHeadersStub = { cookies, headers, draftMode };

export default nextHeadersStub;
