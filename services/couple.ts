import { supabase } from '@/lib/supabase';
import { notifyPartnerConnected } from '@/services/notifications';
import type { Couple, CoupleMember, PartnerType } from '@/types/daydrop';

export type MyCouple = {
  couple: Couple;
  member: CoupleMember;
  members: CoupleMember[];
  availableCouples: MyCoupleOption[];
};

export type MyCoupleOption = {
  couple: Couple;
  member: CoupleMember;
  members: CoupleMember[];
};

export async function getLatestDisconnectedCouple(): Promise<Couple | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: myMembers, error: memberError } = await supabase
    .from('couple_members')
    .select('couple_id')
    .eq('user_id', user.id);

  if (memberError) {
    throw memberError;
  }

  const coupleIds = (myMembers ?? []).map((member) => member.couple_id);
  if (!coupleIds.length) {
    return null;
  }

  const { data, error } = await supabase
    .from('couples')
    .select('*')
    .in('id', coupleIds)
    .eq('status', 'disconnected')
    .order('disconnected_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Couple | null) ?? null;
}

export async function getMyCouple(): Promise<MyCouple | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase.from('profiles').select('selected_couple_id').eq('id', user.id).maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const { data: myMembers, error: memberError } = await supabase
    .from('couple_members')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (memberError) {
    throw memberError;
  }

  if (!myMembers?.length) {
    return null;
  }

  const coupleIds = myMembers.map((member) => member.couple_id);
  const { data: couples, error: couplesError } = await supabase.from('couples').select('*').in('id', coupleIds);

  if (couplesError) {
    throw couplesError;
  }

  const { data: allMembers, error: membersError } = await supabase
    .from('couple_members')
    .select('*')
    .in('couple_id', coupleIds)
    .order('created_at', { ascending: true });

  if (membersError) {
    throw membersError;
  }

  const availableCouples = (myMembers ?? [])
    .map((member) => {
      const couple = (couples ?? []).find((nextCouple) => nextCouple.id === member.couple_id);
      if (!couple || !['active', 'pending'].includes(couple.status)) {
        return null;
      }
      return {
        couple: couple as Couple,
        member: member as CoupleMember,
        members: ((allMembers ?? []) as CoupleMember[]).filter((nextMember) => nextMember.couple_id === member.couple_id),
      };
    })
    .filter((option): option is MyCoupleOption => Boolean(option));

  if (!availableCouples.length) {
    return null;
  }

  const selectedActiveCouple = availableCouples.find((option) => option.couple.id === profile?.selected_couple_id && option.couple.status === 'active');
  const selected =
    selectedActiveCouple ??
    availableCouples.find((option) => option.couple.status === 'active') ??
    availableCouples.find((option) => option.couple.id === profile?.selected_couple_id) ??
    availableCouples[0];

  return {
    ...selected,
    availableCouples,
  };
}

export async function selectCouple(coupleId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('not_authenticated');
  }

  const { error } = await supabase.from('profiles').update({ selected_couple_id: coupleId }).eq('id', user.id);

  if (error) {
    throw error;
  }
}

export async function disconnectPartnerConnection(coupleId: string) {
  const { data, error } = await supabase.rpc('disconnect_partner_connection', {
    p_couple_id: coupleId,
  });

  if (error) {
    throw error;
  }

  return data as { disconnected: boolean; couple_id: string };
}

export async function createCoupleInvite(partnerType: PartnerType) {
  const currentCouple = await getMyCouple();
  const activeCoupleId = currentCouple?.couple.status === 'active' ? currentCouple.couple.id : null;
  const { data, error } = await supabase.rpc('create_couple_invite', {
    p_relationship_start_date: null,
    p_partner_type: partnerType,
  });
  if (error) {
    throw error;
  }
  if (activeCoupleId) {
    await selectCouple(activeCoupleId);
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

  const coupleId = data as string;
  void notifyPartnerConnected(coupleId);
  return coupleId;
}
