import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type Part,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

/**
 * S3-compatible object storage (Cloudflare R2, AWS S3, MinIO, Backblaze B2, Supabase S3).
 * Large uploads go browser → storage directly via presigned multipart URLs, so no video
 * bytes ever pass through the web app or its serverless functions.
 */
export interface StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  provider: string;
}

export function storageConfig(): StorageConfig {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new Error("STORAGE_BUCKET is not set");
  return {
    bucket,
    region: process.env.STORAGE_REGION || "auto",
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    provider: process.env.STORAGE_PROVIDER || "s3",
  };
}

let client: S3Client | null = null;
let publicClient: S3Client | null = null;

function makeClient(endpoint?: string): S3Client {
  const cfg = storageConfig();
  return new S3Client({
    region: cfg.region,
    endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials:
      process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
          }
        : undefined,
    // R2 and MinIO don't support the newer default checksum headers on presigned uploads.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function s3(): S3Client {
  if (!client) client = makeClient(storageConfig().endpoint);
  return client;
}

/**
 * Client used for URLs handed to browsers. Differs from the internal one only when the
 * storage endpoint is reachable under another hostname (e.g. MinIO in docker-compose).
 */
function presignClient(): S3Client {
  const publicEndpoint = process.env.STORAGE_PUBLIC_ENDPOINT;
  if (!publicEndpoint) return s3();
  if (!publicClient) publicClient = makeClient(publicEndpoint);
  return publicClient;
}

const bucket = () => storageConfig().bucket;

// ---------------------------------------------------------------------------------------------
// Key layout — every object lives under the owning user's prefix.
// ---------------------------------------------------------------------------------------------
export const keys = {
  projectPrefix: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/`,
  source: (userId: string, projectId: string, filename: string) =>
    `users/${userId}/projects/${projectId}/source/${sanitizeFilename(filename)}`,
  audio: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/work/audio.ogg`,
  preview: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/work/preview.mp4`,
  waveform: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/work/waveform.bin`,
  thumbnail: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/thumb.jpg`,
  clipFrame: (userId: string, projectId: string, clipId: string) =>
    `users/${userId}/projects/${projectId}/clips/${clipId}/frame.jpg`,
  exportFile: (userId: string, projectId: string, exportId: string, name: string) =>
    `users/${userId}/projects/${projectId}/exports/${exportId}/${sanitizeFilename(name)}`,
};

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return cleaned || "file";
}

// ---------------------------------------------------------------------------------------------
// Multipart (resumable) uploads
// ---------------------------------------------------------------------------------------------
export const MAX_PARTS = 10_000;
export const MIN_PART_SIZE = 8 * 1024 * 1024;

/** Part size that keeps even a 200 GB file under the 10k-part S3 limit. */
export function partSizeFor(fileSize: number): number {
  const needed = Math.ceil(fileSize / (MAX_PARTS - 100));
  const mb = 1024 * 1024;
  return Math.max(MIN_PART_SIZE, Math.ceil(needed / mb) * mb);
}

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await s3().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }));
  if (!res.UploadId) throw new Error("Storage did not return an UploadId");
  return res.UploadId;
}

export async function signUploadParts(key: string, uploadId: string, partNumbers: number[], expiresIn = 3600) {
  const c = presignClient();
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(c, new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }), {
        expiresIn,
      }),
    })),
  );
}

export async function listUploadedParts(key: string, uploadId: string): Promise<Array<{ partNumber: number; etag: string; size: number }>> {
  const parts: Part[] = [];
  let marker: string | undefined;
  do {
    const res = await s3().send(
      new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }),
    );
    parts.push(...(res.Parts ?? []));
    marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
  } while (marker);
  return parts.map((p) => ({ partNumber: p.PartNumber!, etag: p.ETag!, size: p.Size ?? 0 }));
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  await s3().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
}

// ---------------------------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------------------------
export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  } catch (err) {
    if ((err as { name?: string }).name === "NotFound" || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
      return null;
    throw err;
  }
}

export async function signedGetUrl(
  key: string,
  opts: { expiresIn?: number; downloadName?: string; internal?: boolean } = {},
): Promise<string> {
  const c = opts.internal ? s3() : presignClient();
  return getSignedUrl(
    c,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: opts.downloadName
        ? `attachment; filename="${sanitizeFilename(opts.downloadName)}"`
        : undefined,
    }),
    { expiresIn: opts.expiresIn ?? 3600 },
  );
}

export async function putObject(key: string, body: Buffer | string, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

/** Streams a (possibly multi-GB) body into storage using parallel multipart upload. */
export async function uploadStream(
  key: string,
  body: Readable,
  contentType: string,
  onProgress?: (loaded: number) => void,
): Promise<void> {
  const upload = new Upload({
    client: s3(),
    params: { Bucket: bucket(), Key: key, Body: body, ContentType: contentType },
    queueSize: 4,
    partSize: 32 * 1024 * 1024,
    leavePartsOnError: false,
  });
  if (onProgress) upload.on("httpUploadProgress", (p) => p.loaded != null && onProgress(p.loaded));
  await upload.done();
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getObjectStream(key: string): Promise<Readable> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return res.Body as Readable;
}

export async function deleteObjects(keysToDelete: string[]): Promise<void> {
  const unique = [...new Set(keysToDelete.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  let token: string | undefined;
  let deleted = 0;
  do {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
    const found = (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
    if (found.length) {
      await deleteObjects(found);
      deleted += found.length;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}
