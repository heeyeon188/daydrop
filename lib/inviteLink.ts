export const PENDING_INVITE_CODE_STORAGE_KEY = 'daydrop.pendingInviteCode';

export function normalizeInviteCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getInviteCodeFromQueryParams(queryParams?: Record<string, unknown> | null) {
  if (!queryParams) {
    return '';
  }

  const value = queryParams.code ?? queryParams.inviteCode ?? queryParams.invite_code;
  return normalizeInviteCode(Array.isArray(value) ? value[0] : value);
}
