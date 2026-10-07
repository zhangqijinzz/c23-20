import {
  deleteVersionSnapshots,
  estimateStorage,
  readProject,
  readVersionCues,
  writeCurrentProject,
  writeVersionSnapshot,
} from "../services/indexedDbService";
export const projectRepository = {
  load: readProject,
  saveCurrent: writeCurrentProject,
  saveVersion: writeVersionSnapshot,
  loadVersionCues: readVersionCues,
  deleteVersions: deleteVersionSnapshots,
  estimateStorage,
};
