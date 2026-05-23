import { supabase } from '@/lib/supabase';
import type { Couple, CoupleMember } from '@/types/daydrop';

export type MyCouple = {
  couple: Couple;
  member: CoupleMember;
  members: CoupleMember[];
};

export async function getMyCouple(): Promise<MyCouple | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: member, error: memberError } = await supabase.from('couple_members').select('*').eq('user_id', user.id).maybeSingle();

  if (memberError) {
    throw memberError;
  }

  if (!member) {
    return null;
  }

  const { data: couple, error: coupleError } = await supabase.from('couples').select('*').eq('id', member.couple_id).maybeSingle();

  if (coupleError) {
    throw coupleError;
  }

  if (!couple) {
    return null;
  }

  const { data: members, error: membersError } = await supabase
    .from('couple_members')
    .select('*')
    .eq('couple_id', member.couple_id)
    .order('created_at', { ascending: true });

  if (membersError) {
    throw membersError;
  }

  return {
    couple: couple as Couple,
    member: member as CoupleMember,
    members: (members ?? []) as CoupleMember[],
  };
}

export async function createCoupleInvite(relationshipStartDate?: string | null) {
  const { data, error } = await supabase.rpc('create_couple_invite', {
    p_relationship_start_date: relationshipStartDate || null,
  });
  if (error) {
    throw error;
  }
  return data as string;
}

export async function joinCoupleByInviteCode(inviteCode: string) {
  const { data, error } = await supabase.rpc('join_couple_by_invite_code', {
    p_invite_code: inviteCode.trim().toUpperCase(),
  });

  if (error) {
    throw error;
  }

  return data as string;
}
