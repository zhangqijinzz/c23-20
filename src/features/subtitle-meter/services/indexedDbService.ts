import type { SubtitleProject } from "../models";
const DB_NAME = "subtitle-meter-db",
  STORE = "projects";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地存储不可用"));
  });
}
export async function readProject(): Promise<SubtitleProject | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE)
      .objectStore(STORE)
      .get("subtitle-meter.current.v1");
    request.onsuccess = () => {
      const value = request.result;
      resolve(
        value && Array.isArray(value.cues) && Array.isArray(value.versions)
          ? value
          : null,
      );
      db.close();
    };
    request.onerror = () => {
      reject(request.error);
      db.close();
    };
  });
}
export async function writeProject(project: SubtitleProject): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction
      .objectStore(STORE)
      .put({ ...project, id: "subtitle-meter.current.v1" });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("本地保存失败"));
    };
  });
}
