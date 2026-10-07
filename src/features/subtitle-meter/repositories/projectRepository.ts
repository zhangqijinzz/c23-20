import type {
  StorageInfo,
  SubtitleCue,
  SubtitleProject,
  VersionMeta,
} from "../models";
import {
  appendVersion,
  clearVersions,
  deleteVersion,
  getStorageInfo,
  readProject,
  readVersionCues,
  replaceCues,
  replaceProject,
  saveCuePatch,
  saveMetaPatch,
  writeProject,
} from "../services/indexedDbService";

/**
 * 项目仓库：当前编辑内容与快照分层存储。
 * - saveCuePatch : 编辑时只写变化的 cue，不触碰快照
 * - addVersion   : 快照只在保存时写入独立存储
 * - loadVersion  : 回退时才按需读取快照内容
 * - deleteVersion/clearVersions : 清理快照，不影响当前内容
 */
export const projectRepository = {
  load: readProject,
  /** 整体写入（导入新项目使用），会清空旧项目的快照 */
  save: writeProject,
  replace: replaceProject,
  saveCuePatch: (input: { changedCue: SubtitleCue; updatedAt: number }) =>
    saveCuePatch(input),
  replaceCues: (input: { cues: SubtitleCue[]; updatedAt: number }) =>
    replaceCues(input),
  saveMetaPatch: (input: {
    name?: string;
    format?: SubtitleProject["format"];
    updatedAt: number;
    cueIds?: string[];
    versions?: VersionMeta[];
  }) => saveMetaPatch(input),
  addVersion: (input: {
    id: string;
    label: string;
    savedAt: number;
    cues: SubtitleCue[];
    versions: VersionMeta[];
    updatedAt: number;
  }) => appendVersion(input),
  loadVersionCues: (versionId: string) => readVersionCues(versionId),
  deleteVersion: (
    versionId: string,
    versions: VersionMeta[],
    updatedAt: number,
  ) => deleteVersion(versionId, versions, updatedAt),
  clearVersions: (updatedAt: number) => clearVersions(updatedAt),
  storageInfo: (): Promise<StorageInfo | null> => getStorageInfo(),
};
