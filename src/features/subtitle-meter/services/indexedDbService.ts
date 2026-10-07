import type {
  StorageInfo,
  SubtitleCue,
  SubtitleProject,
  VersionMeta,
  VersionSnapshot,
} from "../models";

const DB_NAME = "subtitle-meter-db";
const DB_VERSION = 2;
const PROJECT_STORE = "projects";
const VERSION_STORE = "versions";
const CURRENT_KEY = "subtitle-meter.current.v1";
const SCHEMA = 2;

type LegacyRecord = Record<string, unknown> & { schema?: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE))
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(VERSION_STORE))
        db.createObjectStore(VERSION_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地存储不可用"));
  });
}

function toMeta(value: unknown): VersionMeta | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string") return null;
  return {
    id: entry.id,
    label: typeof entry.label === "string" ? entry.label : "快照",
    savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0,
  };
}

function toMetas(versions: unknown): VersionMeta[] {
  if (!Array.isArray(versions)) return [];
  return versions
    .map(toMeta)
    .filter((meta): meta is VersionMeta => meta !== null);
}

function runTransaction(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void,
  failure: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(failure));
  });
}

function putCurrent(db: IDBDatabase, project: SubtitleProject): Promise<void> {
  return runTransaction(
    db,
    PROJECT_STORE,
    "readwrite",
    (store) =>
      store.put({
        ...project,
        versions: toMetas(project.versions),
        schema: SCHEMA,
        id: CURRENT_KEY,
      }),
    "本地保存失败",
  );
}

function normalizeProject(record: LegacyRecord): SubtitleProject {
  return {
    id: CURRENT_KEY,
    name: typeof record.name === "string" ? record.name : "未命名项目",
    format: record.format === "vtt" ? "vtt" : "srt",
    cues: record.cues as SubtitleCue[],
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    versions: toMetas(record.versions),
  };
}

// 旧结构把快照内容嵌在项目记录里。迁移先把快照内容整体写入独立的
// versions 仓库（单个事务，要么全成要么全不成），成功后才替换项目记录；
// 在此之前旧记录保持原样，中断后下次打开会按同样结果重迁。
async function migrateLegacyRecord(
  db: IDBDatabase,
  record: LegacyRecord,
): Promise<SubtitleProject> {
  const legacyVersions = Array.isArray(record.versions) ? record.versions : [];
  const snapshots: VersionSnapshot[] = [];
  for (const entry of legacyVersions) {
    const meta = toMeta(entry);
    const cues = (entry as Record<string, unknown>)?.cues;
    if (meta && Array.isArray(cues))
      snapshots.push({ ...meta, cues: cues as SubtitleCue[] });
  }
  if (snapshots.length > 0)
    await runTransaction(
      db,
      VERSION_STORE,
      "readwrite",
      (store) => snapshots.forEach((snapshot) => store.put(snapshot)),
      "快照迁移失败",
    );
  const project: SubtitleProject = {
    ...normalizeProject(record),
    versions: snapshots.map(({ id, label, savedAt }) => ({
      id,
      label,
      savedAt,
    })),
  };
  await putCurrent(db, project);
  return project;
}

export async function readProject(): Promise<SubtitleProject | null> {
  const db = await openDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction(PROJECT_STORE)
        .objectStore(PROJECT_STORE)
        .get(CURRENT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray((value as LegacyRecord).cues)
    )
      return null;
    const record = value as LegacyRecord;
    if (record.schema !== SCHEMA) return await migrateLegacyRecord(db, record);
    return normalizeProject(record);
  } finally {
    db.close();
  }
}

export async function writeCurrentProject(
  project: SubtitleProject,
): Promise<void> {
  const db = await openDb();
  try {
    await putCurrent(db, project);
  } finally {
    db.close();
  }
}

export async function writeVersionSnapshot(
  snapshot: VersionSnapshot,
): Promise<void> {
  const db = await openDb();
  try {
    await runTransaction(
      db,
      VERSION_STORE,
      "readwrite",
      (store) => store.put(snapshot),
      "快照保存失败",
    );
  } finally {
    db.close();
  }
}

export async function readVersionCues(
  id: string,
): Promise<SubtitleCue[] | null> {
  const db = await openDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction(VERSION_STORE)
        .objectStore(VERSION_STORE)
        .get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const cues = (value as Record<string, unknown> | undefined)?.cues;
    return Array.isArray(cues) ? (cues as SubtitleCue[]) : null;
  } finally {
    db.close();
  }
}

export async function deleteVersionSnapshots(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  try {
    await runTransaction(
      db,
      VERSION_STORE,
      "readwrite",
      (store) => ids.forEach((id) => store.delete(id)),
      "快照清理失败",
    );
  } finally {
    db.close();
  }
}

export async function estimateStorage(): Promise<StorageInfo> {
  const db = await openDb();
  let snapshotBytes = 0,
    snapshotCount = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(VERSION_STORE);
      const request = transaction.objectStore(VERSION_STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        snapshotCount += 1;
        snapshotBytes += JSON.stringify(cursor.value).length * 2;
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
  let totalBytes: number | null = null;
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.estimate === "function"
    ) {
      const estimate = await navigator.storage.estimate();
      totalBytes = typeof estimate.usage === "number" ? estimate.usage : null;
    }
  } catch {
    totalBytes = null;
  }
  return { totalBytes, snapshotBytes, snapshotCount };
}
