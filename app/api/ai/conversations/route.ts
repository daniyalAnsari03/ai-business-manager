import "server-only";

import { NextResponse } from "next/server";

import { listConversations, searchConversations } from "@/lib/ai/chat-service";
import { getServerUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations?q=... — list or search conversations.
 * Without a query: returns all conversations for the current business, newest first.
 * With a query: searches by title and message content, returns matching conversations.
 */
export async function GET(
  request: Request,
): Promise<Response> {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();

  const result = query
    ? await searchConversations(query)
    : await listConversations();

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  // Return a slim shape — the client only needs id, title, updatedAt.
  return NextResponse.json({
    conversations: result.data.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
    })),
  });
}
