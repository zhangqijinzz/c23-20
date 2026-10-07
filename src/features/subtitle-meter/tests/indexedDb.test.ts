import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SubtitleProject, VersionSnapshot } from "../models";
import {
  deleteVersionSnapshots,
  estimateStorage,
  readProject,
  readVersionCues,
  writeCurrentProject,
  writeVersionSnapshot,
} from "../services/indexedDbService";

const CURRENT_KEY = "subtitle-meter.current.v1";

const sample: SubtitleProject = {
  id: CURRENT_KEY,
  name: "sample.srt",
  format: "srt",
  cues: [{ id: "cue-1", index: 1, startMs: 100, endMs: 2000, text: "Saved" }],
  updatedAt: 1,
  versions: [],
};

const legacyRecord = {
  id: CURRENT_KEY,
  name: "legacy.srt",
  format: "srt",
  cues: [{ id: "cue-1", index: 1, startMs: 100, endMs: 2000, text: "Legacy" }],
  updatedAt: 7,
  versions: [
    {
      id: "v-1",
      label: "快照 1",
      savedAt: 11,
      cues: [{ id: "cue-1", index: 1, startMs: 0, endMs: 900, text: "第一版" }],
    },
    {
      id: "v-2",
      label: "快照 2",
      savedAt: 22,
      cues: [
        { id: "cue-1", index: 1, startMs: 0, endMs: 900, text: "第二版" },
        { id: "cue-2", index: 2, startMs: 1000, endMs: 2000, text: "追加" },
      ],
    },
  ],
};

async function deleteDb() {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("subtitle-meter-db");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function putRawProject(record: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("subtitle-meter-db", 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("projects"))
        database.createObjectStore("projects", { keyPath: "id" });
      if (!database.objectStoreNames.contains("versions"))
        database.createObjectStore("versions", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getRawProject(): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("subtitle-meter-db", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const value = await new Promise<Record<string, unknown> | undefined>(
    (resolve, reject) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .get(CURRENT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  db.close();
  return value;
}

beforeEach(deleteDb);

describe("IndexedDB project storage", () => {
  it("saves and restores the current project without snapshot bodies", async () => {
    await writeCurrentProject(sample);
    expect(await readProject()).toMatchObject({
      name: "sample.srt",
      cues: sample.cues,
    });
  });

  it("stores and loads each snapshot independently", async () => {
    const snapshot: VersionSnapshot = {
      id: "v-1",
      label: "快照 1",
      savedAt: 10,
      cues: [{ id: "cue-1", index: 1, startMs: 0, endMs: 500, text: "A" }],
    };
    await writeVersionSnapshot(snapshot);
    expect(await readVersionCues("v-1")).toEqual(snapshot.cues);
    expect(await readVersionCues("missing")).toBeNull();
  });

  it("editing the current project does not rewrite snapshot records", async () => {
    const snapshot: VersionSnapshot = {
      id: "v-1",
      label: "快照 1",
      savedAt: 10,
      cues: [{ id: "cue-1", index: 1, startMs: 0, endMs: 500, text: "A" }],
    };
    await writeVersionSnapshot(snapshot);
    await writeCurrentProject({
      ...sample,
      versions: [{ id: "v-1", label: "快照 1", savedAt: 10 }],
    });
    await writeCurrentProject({
      ...sample,
      cues: [{ ...sample.cues[0], text: "Edited" }],
      versions: [{ id: "v-1", label: "快照 1", savedAt: 10 }],
    });
    expect((await readProject())?.cues[0].text).toBe("Edited");
    expect(await readVersionCues("v-1")).toEqual(snapshot.cues);
  });

  it("deletes snapshot bodies without touching the current project", async () => {
    await writeVersionSnapshot({
      id: "v-1",
      label: "快照 1",
      savedAt: 10,
      cues: sample.cues,
    });
    await writeVersionSnapshot({
      id: "v-2",
      label: "快照 2",
      savedAt: 20,
      cues: sample.cues,
    });
    await writeCurrentProject({
      ...sample,
      versions: [
        { id: "v-1", label: "快照 1", savedAt: 10 },
        { id: "v-2", label: "快照 2", savedAt: 20 },
      ],
    });
    await deleteVersionSnapshots(["v-1"]);
    expect(await readVersionCues("v-1")).toBeNull();
    expect(await readVersionCues("v-2")).toEqual(sample.cues);
    expect((await readProject())?.cues).toEqual(sample.cues);
  });

  it("reports snapshot count and size", async () => {
    await writeVersionSnapshot({
      id: "v-1",
      label: "快照 1",
      savedAt: 10,
      cues: sample.cues,
    });
    const info = await estimateStorage();
    expect(info.snapshotCount).toBe(1);
    expect(info.snapshotBytes).toBeGreaterThan(0);
  });

  it("downgrades malformed persisted data to an empty project", async () => {
    await putRawProject({
      id: CURRENT_KEY,
      cues: "corrupted",
      versions: [],
    });
    expect(await readProject()).toBeNull();
  });
});

describe("legacy project migration", () => {
  it("migrates inline snapshots to the versions store, preserving order", async () => {
    await putRawProject(legacyRecord);
    const project = await readProject();
    expect(project).toMatchObject({ name: "legacy.srt", updatedAt: 7 });
    expect(project?.cues[0].text).toBe("Legacy");
    expect(project?.versions).toEqual([
      { id: "v-1", label: "快照 1", savedAt: 11 },
      { id: "v-2", label: "快照 2", savedAt: 22 },
    ]);
    expect(await readVersionCues("v-1")).toEqual(legacyRecord.versions[0].cues);
    expect(await readVersionCues("v-2")).toEqual(legacyRecord.versions[1].cues);
  });

  it("replaces the legacy record only after snapshots are migrated", async () => {
    await putRawProject(legacyRecord);
    await readProject();
    const stored = await getRawProject();
    expect(stored?.schema).toBe(2);
    for (const version of stored?.versions as Array<Record<string, unknown>>)
      expect(version).not.toHaveProperty("cues");
  });

  it("recovers when a previous migration was interrupted mid-way", async () => {
    // 模拟上次迁移在写完部分快照后中断：旧记录仍在，快照仓库里残留一条
    await putRawProject(legacyRecord);
    await writeVersionSnapshot({
      ...legacyRecord.versions[0],
      cues: [],
    });
    const project = await readProject();
    expect(project?.versions.map((item) => item.id)).toEqual(["v-1", "v-2"]);
    expect(await readVersionCues("v-1")).toEqual(legacyRecord.versions[0].cues);
    expect(await readVersionCues("v-2")).toEqual(legacyRecord.versions[1].cues);
    // 再次读取结果一致（迁移幂等）
    const again = await readProject();
    expect(again?.versions).toEqual(project?.versions);
    expect(await readVersionCues("v-2")).toEqual(legacyRecord.versions[1].cues);
  });

  it("keeps legacy snapshots without cue bodies out of the version list", async () => {
    await putRawProject({
      ...legacyRecord,
      versions: [
        ...legacyRecord.versions,
        { id: "v-broken", label: "损坏", savedAt: 33 },
      ],
    });
    const project = await readProject();
    expect(project?.versions.map((item) => item.id)).toEqual(["v-1", "v-2"]);
  });
});
