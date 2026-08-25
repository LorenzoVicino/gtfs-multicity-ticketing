declare module "adm-zip" {
  type ZipEntry = {
    entryName: string;
    isDirectory: boolean;
    header: { size: number };
    getData(): Buffer;
  };

  export default class AdmZip {
    constructor(path?: string | Buffer);
    addFile(entryName: string, content: Buffer, comment?: string, attr?: number): void;
    getEntries(): ZipEntry[];
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    extractEntryTo(entry: ZipEntry | string, targetPath: string, maintainEntryPath?: boolean, overwrite?: boolean): void;
    toBuffer(): Buffer;
  }
}
