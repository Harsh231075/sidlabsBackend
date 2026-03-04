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
    console.log('Uploading file to S3:', key);
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
        // ACL not supported by this bucket setting
      })
    );

    return { url: getS3PublicUrl(bucket, region, key), key, provider: 's3' };
  }

  // Default: local filesystem
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  // Use the full key to preserve subfolders (e.g., 'posts/file.png')
  const filePath = path.join(uploadsDir, key);

  // Ensure the specific subfolder exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer);

  const baseUrl = process.env.BASE_URL || 'http://localhost:5001';
  return { url: `${baseUrl}/uploads/${key}`, key, provider: 'local' };
}

async function deleteFile(value) {
  if (!value) return;

  // Extract key from URL or path

  let storageKey = value;
  if (value.startsWith('http')) {
    try {
      const urlObj = new URL(value);
      // If it looks like a local upload URL
      if (urlObj.pathname.startsWith('/uploads/')) {
        storageKey = urlObj.pathname.replace(/^\/uploads\//, '');
      } else {
        // Assume S3 URL or similar: path is the key
        storageKey = urlObj.pathname.replace(/^\//, '');
      }
    } catch (e) {
      // Fallback to simple split if URL parsing fails
      const parts = value.split('/uploads/');
      if (parts.length > 1) {
        storageKey = parts[1];
      }
    }
  } else if (value.startsWith('/uploads/')) {
    storageKey = value.replace('/uploads/', '');
  }

  // Remove leading slashes if any
  storageKey = storageKey.replace(/^\/+/, '');

  if (PROVIDER === 's3') {
    console.log('Deleting file from S3:', storageKey);
    if (!S3Client) return;
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_S3_REGION;
    if (!bucket || !region) return;

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

    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: storageKey,
        })
      );
    } catch (err) {
      console.error('Failed to delete file from S3:', err);
    }
    return;
  }

  // Local filesystem
  try {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const filePath = path.join(uploadsDir, storageKey);
    const flatPath = path.join(uploadsDir, path.basename(storageKey));

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    } else if (fs.existsSync(flatPath)) {
      // Fallback for legacy flat files
      await fs.promises.unlink(flatPath);
    }
  } catch (err) {
    console.error('Failed to delete local file:', err);
  }
}

module.exports = { upload, deleteFile };

