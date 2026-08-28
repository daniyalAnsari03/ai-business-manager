import "server-only";

import { NextResponse } from "next/server";

import { getConversation, deleteConversation } from "@/lib/ai/chat-service";
import { getServerUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations/[id] — fetch a single conversation with its
 * full message history.
 */
export async function GET(
  _request: Request,
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

  const result = await getConversation(id);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    conversation: {
      id: result.data.conversation.id,
      title: result.data.conversation.title,
      updatedAt: result.data.conversation.updatedAt,
    },
    messages: result.data.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      actions: m.actions,
      imageUrl: m.imageUrl ?? null,
      createdAt: m.createdAt,
    })),
  });
}

/**
 * DELETE /api/ai/conversations/[id] — delete a conversation and its messages.
 */
export async function DELETE(
  _request: Request,
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

  const result = await deleteConversation(id);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
