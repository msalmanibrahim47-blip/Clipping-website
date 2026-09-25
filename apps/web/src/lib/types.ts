import type { clipDto, exportDto, projectDetail, projectSummary } from "./serialize";

type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type ProjectSummaryDto = Jsonify<Awaited<ReturnType<typeof projectSummary>>>;
export type ProjectDetailDto = Jsonify<Awaited<ReturnType<typeof projectDetail>>>;
export type ClipDto = Jsonify<Awaited<ReturnType<typeof clipDto>>>;
export type ExportDto = Jsonify<ReturnType<typeof exportDto>>;

export interface JobDto {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  projectId: string | null;
  clipId: string | null;
  exportId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  projectTitle: string | null;
  projectStatus: string | null;
  projectProgress: number | null;
  projectMessage: string | null;
}

export interface SentenceDto {
  i: number;
  s: number;
  e: number;
  t: string;
  p: number;
  sp?: number;
  w?: Array<[number, number, string]>;
}

export interface CaptionCueDto {
  start: number;
  end: number;
  lines: string[];
  words: Array<{ s: number; e: number; w: string }>;
}
