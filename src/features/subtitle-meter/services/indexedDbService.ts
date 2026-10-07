import type {
  StorageInfo,
  SubtitleCue,
  SubtitleProject,
  VersionMeta,
} from "../models";

/**
 * 分层存储（v2）：
 * - projects    : v1 遗留的单条整库记录，迁移完成后删除，保留 store 以便读取旧数据
 * - projectMeta : 当前项目的小元数据（名称/格式/时间/快照目录/cueId 顺序）
 * - cues        : 当前编辑内容，每个 cue 一条记录，编辑时只写变化的 cue
 * - versionMeta : 快照目录之外的快照元数据（字节数）
 * - versionCues : 快照内容，仅在保存快照 / 回退 / 清理时读写
 */
const DB_NAME = "subtitle-meter-db";
const DB_VERSION = 2;
const LEGACY_STORE = "projects";
const META_STORE = "projectMeta";
const CUE_STORE = "cues";
const VERSION_META_STORE = "versionMeta";
const VERSION_CUE_STORE = "versionCues";

const PROJECT_ID = "subtitle-meter.current.v1";
const META_ID = "meta.current";
const SNAPSHOT_WARN_COUNT = 10;

interface ProjectMetaRecord {
  id: string;
  name: string;
  format: SubtitleProject["format"];
  updatedAt: number;
  cueIds: string[];
  versions: VersionMeta[];
}
interface CueRecord extends SubtitleCue {
  id: string;
}
interface VersionMetaRecord extends VersionMeta {
  cueCount: number;
  bytes: number;
  /** 快照内 cue 的原始顺序 */
  cueIds: string[];
}
/** versionCues 主键为 `${versionId}__${cueId}`，索引 by_version 指向 versionId */
interface VersionCueRecord extends SubtitleCue {
  id: string;
  versionId: string;
}
interface LegacyProject {
  id?: unknown;
  name?: unknown;
  format?: unknown;
  updatedAt?: unknown;
  cues?: unknown;
  versions?: unknown;
}
interface LegacyVersion {
  id: unknown;
  label: unknown;
  savedAt: unknown;
  cues: unknown;
}
interface LegacySnapshot {
  id: string;
  label: string;
  savedAt: number;
  cues: SubtitleCue[];
}
interface MigratedProject {
  name: string;
  format: SubtitleProject["format"];
  updatedAt: number;
  cues: SubtitleCue[];
  versions: LegacySnapshot[];
}

const cueKey = (cueId: string) => `${PROJECT_ID}__${cueId}`;
const versionCueKey = (versionId: string, cueId: string) =>
  `${versionId}__${cueId}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // v1 升级到 v2 时浏览器自动保留已有的 projects store；
      // 全新数据库也建好该 store，使迁移逻辑可以统一访问（正常情况下为空）
      if (!db.objectStoreNames.contains(LEGACY_STORE))
        db.createObjectStore(LEGACY_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META_STORE))
        db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CUE_STORE))
        db.createObjectStore(CUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(VERSION_META_STORE))
        db.createObjectStore(VERSION_META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(VERSION_CUE_STORE)) {
        const store = db.createObjectStore(VERSION_CUE_STORE, {
          keyPath: "id",
        });
        store.createIndex("by_version", "versionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地存储不可用"));
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => IDBRequest | Array<IDBRequest> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const request = run(transaction);
    transaction.oncomplete = () =>
      resolve(
        (request && !Array.isArray(request)
          ? (request.result as T)
          : undefined) as T,
      );
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("本地保存失败"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("本地保存中断"));
  });
}

function req<T>(
  store: IDBObjectStore,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = operation(store);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    store.transaction.onerror = () =>
      reject(store.transaction.error ?? new Error("本地读取失败"));
  });
}

const openCursorAll = (store: IDBObjectStore): Promise<unknown[]> =>
  new Promise((resolve, reject) => {
    const rows: unknown[] = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        rows.push(cursor.value);
        cursor.continue();
      } else resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });

const byteSize = (value: unknown): number => {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
};

/* ---------------- 旧项目（v1）迁移 ---------------- */

function isCueLike(value: unknown): value is SubtitleCue {
  if (typeof value !== "object" || value === null) return false;
  const cue = value as Record<string, unknown>;
  return (
    typeof cue.id === "string" &&
    typeof cue.index === "number" &&
    typeof cue.startMs === "number" &&
    typeof cue.endMs === "number" &&
    typeof cue.text === "string"
  );
}

function readLegacy(db: IDBDatabase): Promise<LegacyProject | null> {
  return tx<LegacyProject | null>(db, [LEGACY_STORE], "readonly", (t) =>
    t.objectStore(LEGACY_STORE).get(PROJECT_ID),
  );
}

function isVersionLike(value: unknown): value is LegacyVersion {
  if (typeof value !== "object" || value === null) return false;
  const version = value as Record<string, unknown>;
  return (
    typeof version.id === "string" &&
    typeof version.label === "string" &&
    typeof version.savedAt === "number" &&
    Array.isArray(version.cues)
  );
}

function validLegacy(value: LegacyProject | null): MigratedProject | null {
  if (
    value &&
    typeof value.name === "string" &&
    (value.format === "srt" || value.format === "vtt") &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.cues) &&
    value.cues.every(isCueLike) &&
    Array.isArray(value.versions) &&
    value.versions.every(isVersionLike)
  ) {
    // 快照内个别 cue 损坏时过滤掉坏 cue，但保留快照目录（该快照内容可能为空）
    const versions: LegacySnapshot[] = (value.versions as LegacyVersion[]).map(
      (version) => ({
        id: version.id as string,
        label: version.label as string,
        savedAt: version.savedAt as number,
        cues: Array.isArray(version.cues)
          ? (version.cues as unknown[]).filter(isCueLike)
          : [],
      }),
    );
    return {
      name: value.name,
      format: value.format,
      updatedAt: value.updatedAt,
      cues: value.cues as SubtitleCue[],
      versions,
    };
  }
  return null;
}

/**
 * 崩溃安全迁移，分为两个幂等阶段：
 * A. 旧数据完整复制到 v2 各 store（单事务，要么全成功要么全不动）；
 * B. 只有 A 已完成（v2 meta 存在）才删除旧记录。
 * 任意阶段中断后重新打开都会重走：A 用 put 覆盖可安全重放，旧记录在 A 成功前始终保留。
 */
async function migrateLegacy(db: IDBDatabase): Promise<boolean> {
  const legacy = await readLegacy(db).catch(() => null);
  const project = validLegacy(legacy);

  // 旧数据损坏：保留原样，不迁移也不删除，交给“无项目”的空状态处理
  if (legacy && !project) return false;
  // 没有旧记录说明迁移从未发生过（新用户）或阶段 B 已原子完成，无需动作
  if (!project) return false;

  // 阶段 A：原子写入 v2
  await tx(
    db,
    [META_STORE, CUE_STORE, VERSION_META_STORE, VERSION_CUE_STORE],
    "readwrite",
    (t) => {
      const metaStore = t.objectStore(META_STORE),
        cueStore = t.objectStore(CUE_STORE),
        versionMetaStore = t.objectStore(VERSION_META_STORE),
        versionCueStore = t.objectStore(VERSION_CUE_STORE);
      const requests: IDBRequest[] = [];
      project.cues.forEach((cue) => {
        requests.push(
          cueStore.put({ ...cue, id: cueKey(cue.id) } satisfies CueRecord),
        );
      });
      project.versions.forEach((version) => {
        const cues = version.cues;
        const bytes = byteSize(cues);
        requests.push(
          versionMetaStore.put({
            id: version.id,
            label: version.label,
            savedAt: version.savedAt,
            cueCount: cues.length,
            bytes,
            cueIds: cues.map((cue) => cue.id),
          } satisfies VersionMetaRecord),
        );
        cues.forEach((cue) => {
          requests.push(
            versionCueStore.put({
              ...cue,
              id: versionCueKey(version.id, cue.id),
              versionId: version.id,
            } satisfies VersionCueRecord),
          );
        });
      });
      requests.push(
        metaStore.put({
          id: META_ID,
          name: project.name,
          format: project.format,
          updatedAt: project.updatedAt,
          cueIds: project.cues.map((cue) => cue.id),
          versions: project.versions.map(({ id, label, savedAt }) => ({
            id,
            label,
            savedAt,
          })),
        } satisfies ProjectMetaRecord),
      );
      return requests;
    },
  );

  // 阶段 B：v2 已落盘，删除旧记录
  await deleteLegacy(db);
  return true;
}

function deleteLegacy(db: IDBDatabase): Promise<void> {
  return tx(db, [LEGACY_STORE], "readwrite", (t) =>
    t.objectStore(LEGACY_STORE).delete(PROJECT_ID),
  );
}

/* ---------------- 当前项目 ---------------- */

function readMeta(db: IDBDatabase): Promise<ProjectMetaRecord | undefined> {
  return req<ProjectMetaRecord | undefined>(
    db.transaction(META_STORE).objectStore(META_STORE),
    (s) => s.get(META_ID) as IDBRequest,
  );
}

async function withDb<T>(
  operation: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

/** 读取当前项目；旧格式项目在此一次性迁移到分层存储 */
export async function readProject(): Promise<SubtitleProject | null> {
  return withDb(async (db) => {
    await migrateLegacy(db);
    const meta = await readMeta(db);
    if (!meta) return null;
    if (!Array.isArray(meta.cueIds) || !Array.isArray(meta.versions))
      return null;
    const cueTx = db.transaction(CUE_STORE, "readonly");
    const cues: SubtitleCue[] = [];
    for (const cueId of meta.cueIds) {
      const record = await req<CueRecord | undefined>(
        cueTx.objectStore(CUE_STORE),
        (s) => s.get(cueKey(cueId)) as IDBRequest,
      );
      if (record) {
        const { id, ...cue } = record;
        void id;
        cues.push({ ...cue, id: cueId });
      }
    }
    return {
      id: PROJECT_ID,
      name: meta.name,
      format: meta.format,
      cues,
      updatedAt: meta.updatedAt,
      versions: meta.versions,
    };
  });
}

/** 整体替换当前项目（用于导入新项目），同时清空旧项目的快照 */
export async function replaceProject(project: SubtitleProject): Promise<void> {
  await withDb(async (db) => {
    // 同一事务内先删除旧 cue 再 put 新 cue；请求按顺序执行，
    // 因此与新 cue 同键的 put 会在 delete 之后生效，不会误删新数据
    const existing = await req<IDBValidKey[]>(
      db.transaction(CUE_STORE).objectStore(CUE_STORE),
      (s) => s.getAllKeys() as IDBRequest,
    );
    const ours = existing.filter((key) =>
      String(key).startsWith(`${PROJECT_ID}__`),
    );
    await tx(
      db,
      [META_STORE, CUE_STORE, VERSION_META_STORE, VERSION_CUE_STORE],
      "readwrite",
      (t) => {
        const cueStore = t.objectStore(CUE_STORE);
        ours.forEach((key) => cueStore.delete(key));
        project.cues.forEach((cue) =>
          cueStore.put({ ...cue, id: cueKey(cue.id) } satisfies CueRecord),
        );
        // 新项目不继承旧快照
        t.objectStore(VERSION_CUE_STORE).clear();
        t.objectStore(VERSION_META_STORE).clear();
        t.objectStore(META_STORE).put({
          id: META_ID,
          name: project.name,
          format: project.format,
          updatedAt: project.updatedAt,
          cueIds: project.cues.map((cue) => cue.id),
          versions: [],
        } satisfies ProjectMetaRecord);
      },
    );
  });
}

/** 旧接口的兼容封装（测试与外部调用仍可使用） */
export const writeProject = replaceProject;

/**
 * 增量保存：只写入变化的 cue（单条记录）并更新时间戳。
 * 名称/格式/快照目录/cueIds 均不动，快照相关 store 完全不触碰。
 */
export async function saveCuePatch(input: {
  changedCue: SubtitleCue;
  updatedAt: number;
}): Promise<void> {
  const { changedCue, updatedAt } = input;
  await withDb(async (db) => {
    const current = await readMeta(db);
    if (!current) throw new Error("项目尚未初始化");
    await tx(db, [META_STORE, CUE_STORE], "readwrite", (t) => {
      t.objectStore(CUE_STORE).put({
        ...changedCue,
        id: cueKey(changedCue.id),
      } satisfies CueRecord);
      t.objectStore(META_STORE).put({
        ...current,
        updatedAt,
      } satisfies ProjectMetaRecord);
    });
  });
}

/** 整体替换当前 cues（仅回退快照时使用），快照存储完全不触碰 */
export async function replaceCues(input: {
  cues: SubtitleCue[];
  updatedAt: number;
}): Promise<void> {
  const { cues, updatedAt } = input;
  await withDb(async (db) => {
    const current = await readMeta(db);
    if (!current) throw new Error("项目尚未初始化");
    const existing = await req<IDBValidKey[]>(
      db.transaction(CUE_STORE).objectStore(CUE_STORE),
      (s) => s.getAllKeys() as IDBRequest,
    );
    const ours = existing.filter((key) =>
      String(key).startsWith(`${PROJECT_ID}__`),
    );
    await tx(db, [META_STORE, CUE_STORE], "readwrite", (t) => {
      const cueStore = t.objectStore(CUE_STORE);
      ours.forEach((key) => cueStore.delete(key));
      cues.forEach((cue) =>
        cueStore.put({ ...cue, id: cueKey(cue.id) } satisfies CueRecord),
      );
      t.objectStore(META_STORE).put({
        ...current,
        updatedAt,
        cueIds: cues.map((cue) => cue.id),
      } satisfies ProjectMetaRecord);
    });
  });
}

/** 仅更新项目级元数据（格式/名称/时间/快照目录），不写 cue 内容 */
export async function saveMetaPatch(input: {
  name?: string;
  format?: SubtitleProject["format"];
  updatedAt: number;
  cueIds?: string[];
  versions?: VersionMeta[];
}): Promise<void> {
  await withDb(async (db) => {
    const current = await readMeta(db);
    if (!current) throw new Error("项目尚未初始化");
    await tx(db, [META_STORE], "readwrite", (t) => {
      t.objectStore(META_STORE).put({
        ...current,
        name: input.name ?? current.name,
        format: input.format ?? current.format,
        updatedAt: input.updatedAt,
        cueIds: input.cueIds ?? current.cueIds,
        versions: input.versions ?? current.versions,
      } satisfies ProjectMetaRecord);
    });
  });
}

/* ---------------- 快照 ---------------- */

export async function appendVersion(input: {
  id: string;
  label: string;
  savedAt: number;
  cues: SubtitleCue[];
  versions: VersionMeta[];
  updatedAt: number;
}): Promise<void> {
  await withDb(async (db) => {
    const current = await readMeta(db);
    if (!current) throw new Error("项目尚未初始化");
    await tx(
      db,
      [META_STORE, VERSION_META_STORE, VERSION_CUE_STORE],
      "readwrite",
      (t) => {
        const versionCueStore = t.objectStore(VERSION_CUE_STORE);
        input.cues.forEach((cue) => {
          versionCueStore.put({
            ...cue,
            id: versionCueKey(input.id, cue.id),
            versionId: input.id,
          } satisfies VersionCueRecord);
        });
        t.objectStore(VERSION_META_STORE).put({
          id: input.id,
          label: input.label,
          savedAt: input.savedAt,
          cueCount: input.cues.length,
          bytes: byteSize(input.cues),
          cueIds: input.cues.map((cue) => cue.id),
        } satisfies VersionMetaRecord);
        t.objectStore(META_STORE).put({
          ...current,
          updatedAt: input.updatedAt,
          versions: input.versions,
        } satisfies ProjectMetaRecord);
      },
    );
  });
}

/** 按需加载某个快照的完整内容（回退时调用） */
export async function readVersionCues(
  versionId: string,
): Promise<SubtitleCue[]> {
  return withDb(async (db) => {
    const versionMeta = await req<VersionMetaRecord | undefined>(
      db.transaction(VERSION_META_STORE).objectStore(VERSION_META_STORE),
      (s) => s.get(versionId) as IDBRequest,
    );
    const index = db
      .transaction(VERSION_CUE_STORE)
      .objectStore(VERSION_CUE_STORE)
      .index("by_version");
    const rows = await new Promise<VersionCueRecord[]>((resolve, reject) => {
      const out: VersionCueRecord[] = [];
      const request = index.openCursor(IDBKeyRange.only(versionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          out.push(cursor.value as VersionCueRecord);
          cursor.continue();
        } else resolve(out);
      };
      request.onerror = () => reject(request.error);
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // 以保存/迁移时记录的顺序为准，保证恢复结果与当时完全一致
    const orderedIds =
      versionMeta?.cueIds ??
      rows
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((row) => row.id);
    const prefix = `${versionId}__`;
    return orderedIds.flatMap((storedOrCueId) => {
      const record =
        byId.get(versionCueKey(versionId, storedOrCueId)) ??
        byId.get(storedOrCueId);
      if (!record) return [];
      return [
        {
          id: record.id.slice(prefix.length),
          index: record.index,
          startMs: record.startMs,
          endMs: record.endMs,
          text: record.text,
        },
      ];
    });
  });
}

/** 删除单个快照及其全部内容，当前编辑内容不受影响 */
export async function deleteVersion(
  versionId: string,
  versions: VersionMeta[],
  updatedAt: number,
): Promise<void> {
  await withDb(async (db) => {
    const current = await readMeta(db);
    if (!current) throw new Error("项目尚未初始化");
    await tx(
      db,
      [META_STORE, VERSION_META_STORE, VERSION_CUE_STORE],
      "readwrite",
      (t) => {
        const index = t.objectStore(VERSION_CUE_STORE).index("by_version");
        index.openCursor(IDBKeyRange.only(versionId)).onsuccess = (event) => {
          const cursor = (event.target as IDBRequest)
            .result as IDBCursorWithValue | null;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        t.objectStore(VERSION_META_STORE).delete(versionId);
        t.objectStore(META_STORE).put({
          ...current,
          updatedAt,
          versions,
        } satisfies ProjectMetaRecord);
      },
    );
  });
}

/** 清空全部快照，当前编辑内容（cues store）完全不动 */
export async function clearVersions(updatedAt: number): Promise<void> {
  await withDb(async (db) => {
    const current = await readMeta(db);
    if (!current) throw new Error("项目尚未初始化");
    await tx(
      db,
      [META_STORE, VERSION_META_STORE, VERSION_CUE_STORE],
      "readwrite",
      (t) => {
        t.objectStore(VERSION_CUE_STORE).clear();
        t.objectStore(VERSION_META_STORE).clear();
        t.objectStore(META_STORE).put({
          ...current,
          updatedAt,
          versions: [],
        } satisfies ProjectMetaRecord);
      },
    );
  });
}

/* ---------------- 存储占用 ---------------- */

export async function getStorageInfo(): Promise<StorageInfo | null> {
  return withDb(async (db) => {
    const meta = await readMeta(db);
    if (!meta) return null;
    const versionRows = (await openCursorAll(
      db.transaction(VERSION_META_STORE).objectStore(VERSION_META_STORE),
    )) as VersionMetaRecord[];
    const byId = new Map(versionRows.map((row) => [row.id, row]));
    let snapshotBytes = 0;
    meta.versions.forEach((version) => {
      snapshotBytes += byId.get(version.id)?.bytes ?? 0;
    });
    const cueRows = (await openCursorAll(
      db.transaction(CUE_STORE).objectStore(CUE_STORE),
    )) as CueRecord[];
    const currentBytes = cueRows
      .filter((row) => String(row.id).startsWith(`${PROJECT_ID}__`))
      .reduce((sum, row) => sum + byteSize(row), 0);
    let quotaBytes: number | null = null;
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        quotaBytes = estimate.quota ?? null;
      } catch {
        quotaBytes = null;
      }
    }
    return {
      snapshotCount: meta.versions.length,
      snapshotBytes,
      currentBytes,
      totalBytes: currentBytes + snapshotBytes + byteSize(meta),
      quotaBytes,
    };
  });
}

export const SNAPSHOT_CLEANUP_THRESHOLD = SNAPSHOT_WARN_COUNT;
