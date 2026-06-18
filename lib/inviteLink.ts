export const PENDING_INVITE_CODE_STORAGE_KEY = 'daydrop.pendingInviteCode';

export function normalizeInviteCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
