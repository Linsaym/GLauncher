export const MINECRAFT = "26.3";
export const NEOFORGE = "26.3.0.115";

export interface Settings {
  nickname: string;
  host: string;
  updatePort: number;
  gamePort: number;
  memoryGb: number;
}

export interface Status {
  updates: boolean;
  minecraft: boolean;
}

export interface Progress {
  phase: "idle" | "install" | "sync" | "launch" | "running" | "error";
  message: string;
  fraction?: number;
}

export interface LauncherApi {
  getSettings(): Promise<Settings>;
  saveSettings(value: Settings): Promise<Settings>;
  getStatus(): Promise<Status | null>;
  getProgress(): Promise<Progress>;
  play(): Promise<void>;
  onProgress(listener: (progress: Progress) => void): () => void;
}
