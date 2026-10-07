import { readProject, writeProject } from "../services/indexedDbService";
export const projectRepository = { load: readProject, save: writeProject };
