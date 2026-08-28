import "server-only";

import { NextResponse } from "next/server";

import { deleteMessagesAfter } from "@/lib/ai/chat-service";
import { getServerUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/ai/conversations/[id]/messages
 * Body: { afterMessageId: string }
 *
 * Deletes all messages in the conversation created strictly after the given
 * message. Used when editing a user message — truncates everything after it.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const afterMessageId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).afterMessageId
      : null;

  if (typeof afterMessageId !== "string" || !afterMessageId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await deleteMessagesAfter(id, afterMessageId);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
