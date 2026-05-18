declare module "node:buffer" {
  export class Buffer {
    static from(data: string, encoding?: string): Buffer;
    toString(encoding?: string): string;
  }
}

declare module "node:fs/promises" {
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;

  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare const process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  stdout: { write(data: string): void };
  stderr: { write(data: string): void };
  exit(code?: number): never;
};

declare namespace NodeJS {
  export type ErrnoException = Error & { code?: string };
}
