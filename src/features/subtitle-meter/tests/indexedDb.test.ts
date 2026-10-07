import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SubtitleProject } from "../models";
import {
  appendVersion,
  clearVersions,
  deleteVersion,
  getStorageInfo,
  readProject,
  readVersionCues,
  replaceProject,
  saveCuePatch,
  writeProject,
} from "../services/indexedDbService";

const cue = (id: string, text: string) => ({
  id,
  index: Number(id.slice(4)),
  startMs: 100,
  endMs: 2000,
  text,
});

const newProject = (): SubtitleProject => ({
  id: "subtitle-meter.current.v1",
  name: "sample.srt",
  format: "srt",
  cues: [cue("cue-1", "Saved")],
  updatedAt: 1,
  versions: [],
});

const openDbAt = (version: number, upgrade?: (db: IDBDatabase) => void) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("subtitle-meter-db", version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** 建立一个真实的 v1 形态数据库（仅 projects store）并写入遗留记录；
 * 若数据库已升级到 v2，则直接写入保留下来的遗留 store（用于模拟中断态） */
const putLegacy = async (value: unknown) => {
  const setup = await openDbAt(1, (legacyDb) => {
    if (!legacyDb.objectStoreNames.contains("projects"))
      legacyDb.createObjectStore("projects", { keyPath: "id" });
  }).catch(async () => openDbAt(2));
  setup.close();
  const current = await openDbAt(setup.version === 1 ? 1 : 2);
  await new Promise<void>((resolve, reject) => {
    const transaction = current.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  current.close();
};

const getLegacy = async () => {
  // 迁移后数据库可能已升到 v2，按当前版本打开再访问遗留 store
  const db = await openDbAt(2);
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db
      .transaction("projects")
      .objectStore("projects")
      .get("subtitle-meter.current.v1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
};

const resetDb = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("subtitle-meter-db");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

beforeEach(async () => {
  await resetDb();
});
afterEach(async () => {
  await resetDb();
});

describe("layered IndexedDB storage", () => {
  it("saves and restores the current project from layered stores", async () => {
    await writeProject(newProject());
    expect(await readProject()).toMatchObject({
      name: "sample.srt",
      cues: [cue("cue-1", "Saved")],
    });
  });

  it("writes only the changed cue on edit and keeps cue order", async () => {
    await writeProject({
      ...newProject(),
      cues: [cue("cue-1", "A"), cue("cue-2", "B"), cue("cue-3", "C")],
    });
    const project = (await readProject())!;
    const changed = { ...project.cues[1], text: "B2" };
    await saveCuePatch({
      changedCue: changed,
      updatedAt: 2,
    });
    const reloaded = (await readProject())!;
    expect(reloaded.cues.map((c) => c.id)).toEqual(["cue-1", "cue-2", "cue-3"]);
    expect(reloaded.cues[1].text).toBe("B2");
    expect(reloaded.cues[0].text).toBe("A");
  });

  it("stores snapshots separately and lazily loads their cues", async () => {
    await writeProject({
      ...newProject(),
      cues: [cue("cue-1", "Current")],
    });
    await appendVersion({
      id: "v-100",
      label: "快照 1",
      savedAt: 100,
      cues: [cue("cue-1", "Snapshot A"), cue("cue-2", "Snapshot B")],
      versions: [{ id: "v-100", label: "快照 1", savedAt: 100 }],
      updatedAt: 100,
    });
    // readProject 只带回快照目录，不载入快照内容
    const listed = (await readProject())!;
    expect(listed.versions).toEqual([
      { id: "v-100", label: "快照 1", savedAt: 100 },
    ]);
    // 回退时按需加载，顺序与保存时一致
    expect((await readVersionCues("v-100")).map((c) => c.text)).toEqual([
      "Snapshot A",
      "Snapshot B",
    ]);
    // 保存快照之后继续编辑当前内容，快照内容保持不变
    const changed = { ...(await readProject())!.cues[0], text: "Current v2" };
    await saveCuePatch({ changedCue: changed, updatedAt: 150 });
    expect((await readVersionCues("v-100")).map((c) => c.text)).toEqual([
      "Snapshot A",
      "Snapshot B",
    ]);
    expect((await readProject())!.cues[0].text).toBe("Current v2");
  });

  it("clearing snapshots leaves the current cues untouched", async () => {
    await replaceProject({
      ...newProject(),
      cues: [cue("cue-1", "Current")],
    });
    await appendVersion({
      id: "v-100",
      label: "快照 1",
      savedAt: 100,
      cues: [cue("cue-1", "Snapshot")],
      versions: [{ id: "v-100", label: "快照 1", savedAt: 100 }],
      updatedAt: 100,
    });
    await clearVersions(200);
    const after = (await readProject())!;
    expect(after.versions).toEqual([]);
    expect(after.cues[0].text).toBe("Current");
    expect(await readVersionCues("v-100")).toEqual([]);
  });

  it("deletes one snapshot and keeps the others", async () => {
    await writeProject({
      ...newProject(),
      cues: [cue("cue-1", "Current")],
    });
    const versions = [
      { id: "v-100", label: "快照 1", savedAt: 100 },
      { id: "v-200", label: "快照 2", savedAt: 200 },
    ];
    await appendVersion({
      ...versions[0],
      cues: [cue("cue-1", "A")],
      versions,
      updatedAt: 100,
    });
    await appendVersion({
      ...versions[1],
      cues: [cue("cue-1", "B")],
      versions,
      updatedAt: 200,
    });
    await deleteVersion("v-100", [versions[1]], 300);
    expect(await readVersionCues("v-100")).toEqual([]);
    expect((await readVersionCues("v-200"))[0].text).toBe("B");
    expect((await readProject())!.versions).toEqual([versions[1]]);
  });

  it("reports storage usage split between current content and snapshots", async () => {
    await writeProject({
      ...newProject(),
      cues: [cue("cue-1", "Current content")],
    });
    await appendVersion({
      id: "v-100",
      label: "快照 1",
      savedAt: 100,
      cues: [cue("cue-1", "Snapshot content")],
      versions: [{ id: "v-100", label: "快照 1", savedAt: 100 }],
      updatedAt: 100,
    });
    const info = await getStorageInfo();
    expect(info).not.toBeNull();
    expect(info!.snapshotCount).toBe(1);
    expect(info!.currentBytes).toBeGreaterThan(0);
    expect(info!.snapshotBytes).toBeGreaterThan(0);
    expect(info!.totalBytes).toBeGreaterThanOrEqual(
      info!.currentBytes + info!.snapshotBytes,
    );
  });
});

describe("v1 legacy project migration", () => {
  const legacyProject = (): SubtitleProject & {
    versions: Array<{
      id: string;
      label: string;
      savedAt: number;
      cues: ReturnType<typeof cue>[];
    }>;
  } => ({
    id: "subtitle-meter.current.v1",
    name: "legacy.srt",
    format: "srt",
    cues: [cue("cue-1", "旧字幕 1"), cue("cue-2", "旧字幕 2")],
    updatedAt: 50,
    versions: [
      {
        id: "v-1",
        label: "快照 1",
        savedAt: 10,
        cues: [cue("cue-1", "旧字幕 1"), cue("cue-2", "旧字幕 2")],
      },
      {
        id: "v-2",
        label: "快照 2",
        savedAt: 20,
        cues: [cue("cue-1", "改过的字幕"), cue("cue-2", "旧字幕 2")],
      },
    ],
  });

  it("migrates legacy data preserving snapshot count, order and restore result", async () => {
    await putLegacy(legacyProject());
    const migrated = await readProject();
    expect(migrated).toMatchObject({
      name: "legacy.srt",
      format: "srt",
      cues: [cue("cue-1", "旧字幕 1"), cue("cue-2", "旧字幕 2")],
    });
    expect(migrated!.versions.map((v) => v.id)).toEqual(["v-1", "v-2"]);
    expect(migrated!.versions.map((v) => v.label)).toEqual([
      "快照 1",
      "快照 2",
    ]);
    expect((await readVersionCues("v-1")).map((c) => c.text)).toEqual([
      "旧字幕 1",
      "旧字幕 2",
    ]);
    expect((await readVersionCues("v-2")).map((c) => c.text)).toEqual([
      "改过的字幕",
      "旧字幕 2",
    ]);
    // 迁移完成后旧记录已清理
    expect(await getLegacy()).toBeUndefined();
  });

  it("is idempotent when migration is interrupted after the new stores were written", async () => {
    await putLegacy(legacyProject());
    // 模拟阶段 A 成功后、阶段 B（删除旧记录）前中断：
    // v2 数据已存在，同时旧记录也还在
    await readProject();
    await putLegacy(legacyProject());
    // 再次打开应安全完成迁移，结果与首次一致
    const again = await readProject();
    expect(again!.versions.map((v) => v.id)).toEqual(["v-1", "v-2"]);
    expect((await readVersionCues("v-2"))[0].text).toBe("改过的字幕");
    expect(await getLegacy()).toBeUndefined();
  });

  it("keeps malformed legacy data untouched instead of losing it", async () => {
    await putLegacy({
      id: "subtitle-meter.current.v1",
      cues: "corrupted",
      versions: [],
    });
    expect(await readProject()).toBeNull();
    // 损坏的原数据未被删除，仍可排查或由后续版本修复
    const untouched = await getLegacy();
    expect(untouched).toMatchObject({ cues: "corrupted" });
  });
});
