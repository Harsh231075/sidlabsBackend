const fs = require('fs');
const path = require('path');
let S3Client, PutObjectCommand;

try {
  // Load lazily to avoid requiring AWS SDK when not used
  ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
} catch (_) {
  // No-op if package not installed; will throw only if S3 is actually used
}

const PROVIDER = process.env.STORAGE_PROVIDER || 'local';

function getS3PublicUrl(bucket, region, key) {
  const base = process.env.AWS_S3_PUBLIC_URL_BASE;
  if (base) return `${base.replace(/\/$/, '')}/${key}`;
  if (region) return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

async function upload({ buffer, contentType, key }) {
  if (PROVIDER === 's3') {
    if (!S3Client || !PutObjectCommand) {
      throw new Error('AWS SDK not installed. Run `npm install @aws-sdk/client-s3`');
    }

    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_S3_REGION;
    if (!bucket || !region) {
      throw new Error('Missing AWS S3 config: set AWS_S3_BUCKET and AWS_S3_REGION');
    }

    const client = new S3Client({
      region,
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
          : undefined,
    });

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: process.env.AWS_S3_ACL || 'public-read',
      })
    );

    return { url: getS3PublicUrl(bucket, region, key), key, provider: 's3' };
  }

  // Default: local filesystem
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const filename = path.basename(key);
  const filePath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return { url: `/uploads/${filename}`, key: filename, provider: 'local' };
}

module.exports = { upload };
