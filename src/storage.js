'use strict';
/**
 * Where lesson videos live.
 *
 * - S3_BUCKET set: S3-compatible object storage (Backblaze B2's free 10 GB in production). Render's free plan
 *   has no persistent disk, so files saved on the server vanish on every restart and cannot hold videos.
 *   The bucket stays private: after checking access, the server redirects the player to a link that expires.
 * - Otherwise: DATA_DIR/videos on local disk (local previews, or a paid server with a persistent disk).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const aws4 = require('aws4');
const { VIDEO_DIR } = require('./db');

// Long enough to watch a full lesson with pauses; a copied link stops working after this.
const LINK_SECONDS = 4 * 3600;

function s3Config() {
  if (!process.env.S3_BUCKET) return null;
  const raw = String(process.env.S3_ENDPOINT || '').trim();
  if (!raw) throw new Error('S3_BUCKET is set but S3_ENDPOINT is empty (e.g. s3.eu-central-003.backblazeb2.com).');
  const endpoint = new URL(raw.includes('://') ? raw : `https://${raw}`);
  // Backblaze endpoints name their region: s3.<region>.backblazeb2.com
  const region = process.env.S3_REGION || (/^s3\.([a-z0-9-]+)\./.exec(endpoint.hostname) || [])[1] || 'us-east-1';
  return {
    endpoint,
    region,
    bucket: process.env.S3_BUCKET,
    creds: { accessKeyId: process.env.S3_KEY_ID || '', secretAccessKey: process.env.S3_SECRET || '' },
  };
}
const S3 = s3Config();

// Object keys are server-made (uuid + extension); basename() keeps any stored value inside the bucket or folder.
const keyPath = (key) => `/${S3.bucket}/${encodeURIComponent(path.basename(key))}`;

/** Sends one signed request to the bucket. `file` (optional) is streamed as the body. */
function s3Request(method, key, { headers = {}, file } = {}) {
  const signed = aws4.sign({ host: S3.endpoint.host, path: keyPath(key), service: 's3', region: S3.region, method, headers }, S3.creds);
  const lib = S3.endpoint.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { hostname: S3.endpoint.hostname, port: S3.endpoint.port || undefined, method, path: signed.path, headers: signed.headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          res.statusCode < 300 || (method === 'DELETE' && res.statusCode === 404)
            ? resolve()
            : reject(new Error(`Video storage ${method} failed (${res.statusCode}): ${body.slice(0, 300)}`))
        );
      }
    );
    req.on('error', reject);
    if (file) fs.createReadStream(file).on('error', reject).pipe(req);
    else req.end();
  });
}

const storage = {
  kind: S3 ? 's3' : 'disk',
  /** Extra origin the video player loads from, for the Content-Security-Policy. */
  mediaOrigin: S3 ? S3.endpoint.origin : '',
  /** Where multer writes an upload: straight into the videos folder, or a temp file on its way to the bucket. */
  uploadDir: S3 ? os.tmpdir() : VIDEO_DIR,

  /** Finishes an upload that multer has written to `file.path`. */
  async save(file) {
    if (!S3) return;
    try {
      await s3Request('PUT', file.filename, {
        file: file.path,
        // Not hashing a multi-gigabyte body keeps uploads fast on a small server; TLS already protects it.
        headers: { 'Content-Type': file.mimetype, 'Content-Length': file.size, 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD' },
      });
    } finally {
      fs.rm(file.path, { force: true }, () => {});
    }
  },

  async remove(key) {
    if (S3) return s3Request('DELETE', key);
    await fs.promises.rm(path.join(VIDEO_DIR, path.basename(key)), { force: true });
  },

  /** A link to the video that expires (bucket mode only). */
  signedUrl(key) {
    const signed = aws4.sign(
      { host: S3.endpoint.host, path: `${keyPath(key)}?X-Amz-Expires=${LINK_SECONDS}`, service: 's3', region: S3.region, method: 'GET', signQuery: true },
      S3.creds
    );
    return `${S3.endpoint.protocol}//${S3.endpoint.host}${signed.path}`;
  },
};

module.exports = storage;
