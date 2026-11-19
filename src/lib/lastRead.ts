export interface LastRead {
  page: number;
  surah: number;
  tname: string;
  juz: number;
}

const KEY = "lastRead";

export function loadLastRead(): LastRead | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      raw &&
      Number.isInteger(raw.page) &&
      raw.page >= 1 &&
      raw.page <= 604 &&
      Number.isInteger(raw.surah) &&
      typeof raw.tname === "string" &&
      Number.isInteger(raw.juz)
    ) {
      return raw as LastRead;
    }
  } catch {
    /* private mode or bad storage */
  }
  return null;
}

export function saveLastRead(entry: LastRead): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* private mode */
  }
}
