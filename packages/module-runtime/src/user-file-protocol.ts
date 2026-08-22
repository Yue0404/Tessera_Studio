import type { PackageFileDescriptor } from "./types.js";

export type UserFileWorkerRequest =
  | { readonly type: "list"; readonly file: File }
  | { readonly type: "open"; readonly path: string }
  | { readonly type: "ack" };

export type UserFileWorkerResponse =
  | {
      readonly type: "listed";
      readonly files: readonly PackageFileDescriptor[];
    }
  | { readonly type: "chunk"; readonly chunk: Uint8Array }
  | { readonly type: "complete" }
  | {
      readonly type: "error";
      readonly code: string;
      readonly path: string;
      readonly details: Readonly<Record<string, unknown>>;
      readonly message: string;
    };

export interface UserFileWorkerLike {
  onmessage: ((event: MessageEvent<UserFileWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: UserFileWorkerRequest): void;
  terminate(): void;
}
