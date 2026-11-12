import { GAME_CONFIG } from '../rules/gameConfig.ts';

const ALLOWED_DRAFT_CHARS_RE = /[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g;

/**
 * Strips spaces and special characters outside Korean/English/digits and enforces max 8 chars.
 * Should only be called outside active Korean IME composition so syllable assembly isn't broken.
 */
export function normalizeNicknameDraft(raw: string): string {
  const cleaned = raw.replace(ALLOWED_DRAFT_CHARS_RE, '');
  return cleaned.slice(0, GAME_CONFIG.leaderboard.maxNicknameLength);
}

/**
 * Checks whether a normalized nickname contains any banned word (case-insensitive).
 */
export function isBannedNickname(nickname: string): boolean {
  const lower = nickname.toLowerCase();
  if (!lower) return false;
  return GAME_CONFIG.leaderboard.bannedNicknames.some((word) =>
    lower.includes(word.toLowerCase())
  );
}

/**
 * Normalizes and validates a final submitted nickname:
 * - Removes spaces/special characters
 * - Truncates to 8 characters
 * - Defaults empty or banned nicknames to '갈매기'
 */
export function sanitizeNickname(raw: string): string {
  const normalized = normalizeNicknameDraft(raw);
  if (!normalized || isBannedNickname(normalized)) {
    return GAME_CONFIG.leaderboard.defaultNickname;
  }
  return normalized;
}

export interface StorageLikeReader {
  getItem(key: string): string | null;
}

export interface StorageLikeWriter {
  setItem(key: string, value: string): void;
}

export function loadLastNickname(storage?: StorageLikeReader | null): string {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
        ? window.localStorage
        : null;
    if (!target) return '';
    const raw = target.getItem(GAME_CONFIG.leaderboard.lastNicknameStorageKey);
    if (!raw) return '';
    const draft = normalizeNicknameDraft(raw);
    return isBannedNickname(draft) ? '' : draft;
  } catch {
    return '';
  }
}

export function saveLastNickname(
  nickname: string,
  storage?: StorageLikeWriter | null
): void {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
        ? window.localStorage
        : null;
    if (!target) return;
    const clean = sanitizeNickname(nickname);
    target.setItem(GAME_CONFIG.leaderboard.lastNicknameStorageKey, clean);
  } catch {
    // Ignore storage quota or blocked localStorage errors cleanly
  }
}
