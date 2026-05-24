import type { User } from '@supabase/supabase-js';

export type DropState = 'none' | 'meOnly' | 'partnerOnly' | 'both';
export type PartnerType = 'couple' | 'friend';
export type MissionAudience = 'common' | PartnerType;

export type AuthUser = User;

export type Profile = {
  id: string;
  display_name: string | null;
  country: string | null;
  city: string | null;
  timezone?: string | null;
  preferred_language: 'ko' | 'en' | null;
  selected_couple_id?: string | null;
  profile_completed: boolean | null;
  created_at: string;
  updated_at: string;
};

export type Couple = {
  id: string;
  invite_code: string;
  created_by: string | null;
  status: 'pending' | 'active';
  partner_type: PartnerType | null;
  relationship_start_date: string | null;
  created_at: string;
  connected_at: string | null;
};

export type CoupleMember = {
  id: string;
  couple_id: string;
  user_id: string;
  role: 'owner' | 'partner';
  display_name: string | null;
  country: string | null;
  city: string | null;
  timezone?: string | null;
  created_at: string;
};

export type Mission = {
  id: string;
  prompt_ko: string;
  prompt_en: string | null;
  mission_type: string | null;
  audience: MissionAudience | null;
  active: boolean | null;
  sort_order: number | null;
  created_at: string;
};

export type DailyDrop = {
  id: string;
  couple_id: string;
  mission_id: string | null;
  drop_date: string;
  day_count: number | null;
  created_at: string;
};

export type DropSubmission = {
  id: string;
  drop_id: string;
  couple_id: string;
  user_id: string;
  image_url: string;
  storage_path: string;
  note: string | null;
  submitted_at: string;
};

export type TodayDropPayload = {
  daily_drop: DailyDrop;
  mission: Mission;
  couple: Couple;
  members: CoupleMember[];
  submissions: DropSubmission[];
};

export type RecentDrop = DailyDrop & {
  mission: Pick<Mission, 'prompt_ko' | 'prompt_en'> | null;
  drop_submissions: DropSubmission[];
};
