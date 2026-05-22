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

  console.log('[useMyCouple] user', user?.id);

  if (!user) {
    console.log('[useMyCouple] final myCouple', null);
    return null;
  }

  const { data: member, error: memberError } = await supabase
    .from('couple_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  console.log('[useMyCouple] member', member, memberError);

  if (memberError) {
    throw memberError;
  }

  if (!member) {
    console.log('[useMyCouple] final myCouple', null);
    return null;
  }

  const { data: couple, error: coupleError } = await supabase
    .from('couples')
    .select('*')
    .eq('id', member.couple_id)
    .maybeSingle();

  console.log('[useMyCouple] couple', couple, coupleError);

  if (coupleError) {
    throw coupleError;
  }

  if (!couple) {
    console.log('[useMyCouple] final myCouple', null);
    return null;
  }

  const { data: members, error: membersError } = await supabase
    .from('couple_members')
    .select('*')
    .eq('couple_id', member.couple_id)
    .order('created_at', { ascending: true });

  console.log('[useMyCouple] members', members, membersError);

  if (membersError) {
    throw membersError;
  }

  const finalCouple = {
    couple: couple as Couple,
    member: member as CoupleMember,
    members: (members ?? []) as CoupleMember[],
  };

  console.log('[useMyCouple] final myCouple', finalCouple);

  return finalCouple;
}

export async function createCoupleInvite() {
  const { data, error } = await supabase.rpc('create_couple_invite');
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

  const { data: couple, error: coupleError } = await supabase
    .from('couples')
    .select('id, status, connected_at')
    .eq('id', data)
    .maybeSingle();

  console.log('[joinCoupleByInviteCode] couple status after join', couple, coupleError);

  return data as string;
}
