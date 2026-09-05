import { prisma } from "@/lib/prisma";

// Customizable budget reminders: which pace heads-ups the user wants.
//  - half:   a note the moment you cross 50% of the budget (early if off-pace)
//  - full:   a note when the budget is fully spent / exceeded
//  - weekly: a "week N of M" pace check-in splitting the month into weeks

export interface AlertPrefs {
  half: boolean;
  full: boolean;
  weekly: boolean;
}

const KEY = "alertPrefs";
export const DEFAULT_PREFS: AlertPrefs = { half: true, full: true, weekly: false };

export async function getAlertPrefs(): Promise<AlertPrefs> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setAlertPrefs(prefs: Partial<AlertPrefs>): Promise<AlertPrefs> {
  const current = await getAlertPrefs();
  const next = { ...current, ...prefs };
  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(next) },
    create: { key: KEY, value: JSON.stringify(next) },
  });
  return next;
}
