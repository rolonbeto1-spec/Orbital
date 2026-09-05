import "server-only";
import { getJsonSetting, setJsonSetting } from "@/lib/db-helpers";

/**
 * Budget reminder preferences, per user.
 *
 * Stored in the (userId, key) Setting table. The old version used a single
 * global "alertPrefs" key, which in a multi-tenant app would mean everyone
 * shared one set of reminder preferences (§6).
 */

export interface AlertPrefs {
  half: boolean;
  full: boolean;
  weekly: boolean;
}

const KEY = "alertPrefs";
export const DEFAULT_PREFS: AlertPrefs = { half: true, full: true, weekly: false };

export async function getAlertPrefs(userId: string): Promise<AlertPrefs> {
  const stored = await getJsonSetting<Partial<AlertPrefs>>(userId, KEY, {});
  return { ...DEFAULT_PREFS, ...stored };
}

export async function setAlertPrefs(
  userId: string,
  prefs: Partial<AlertPrefs>,
): Promise<AlertPrefs> {
  const current = await getAlertPrefs(userId);
  const next: AlertPrefs = { ...current, ...prefs };
  await setJsonSetting(userId, KEY, next);
  return next;
}
