declare module "adm-zip" {
  type ZipEntry = {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  };

  export default class AdmZip {
    constructor(path?: string);
    getEntries(): ZipEntry[];
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    extractEntryTo(entry: ZipEntry | string, targetPath: string, maintainEntryPath?: boolean, overwrite?: boolean): void;
  }
}
