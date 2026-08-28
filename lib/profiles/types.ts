import type { Language } from "@/lib/business/types";

/** Application-level profile for the authenticated Supabase user. */
export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  preferredLanguage: Language;
  createdAt: string;
  updatedAt: string;
}
