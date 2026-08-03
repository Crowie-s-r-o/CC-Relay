import { basename } from 'node:path';

export const MAX_IMAGE_ATTACHMENTS = 99;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_TASK_REQUEST_BYTES = 30 * 1024 * 1024;

const SUPPORTED_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

function hasExpectedSignature(data, mimeType) {
  if (mimeType === 'image/png') {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (mimeType === 'image/jpeg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return data.length >= 12
      && data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function safeOriginalName(value, index, extension) {
  const original = basename(typeof value === 'string' ? value.trim() : '').replace(/[\u0000-\u001f]/g, '');
  return (original || `image-${index + 1}.${extension}`).slice(0, 140);
}

export function imageExtension(mimeType) {
  return SUPPORTED_TYPES.get(mimeType) || null;
}

export function decodeImageAttachments(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Image attachments must be an array.');
  }
  if (value.length > MAX_IMAGE_ATTACHMENTS) {
    throw new Error(`Attach at most ${MAX_IMAGE_ATTACHMENTS} images to one task.`);
  }

  let totalBytes = 0;
  return value.map((attachment, index) => {
    const mimeType = typeof attachment?.mimeType === 'string'
      ? attachment.mimeType.trim().toLowerCase()
      : '';
    const extension = imageExtension(mimeType);
    if (!extension) {
      throw new Error('CC Relay accepts PNG, JPEG, and WebP images.');
    }
    const encoded = typeof attachment?.data === 'string' ? attachment.data : '';
    const prefix = `data:${mimeType};base64,`;
    if (!encoded.startsWith(prefix)) {
      throw new Error(`Image ${index + 1} has an invalid data URL.`);
    }
    const base64 = encoded.slice(prefix.length);
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error(`Image ${index + 1} has invalid base64 data.`);
    }
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
      throw new Error(`Each image must be smaller than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    }
    if (!hasExpectedSignature(data, mimeType)) {
      throw new Error(`Image ${index + 1} does not match its declared file type.`);
    }
    totalBytes += data.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error(`Image attachments may total at most ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024} MB.`);
    }
    return {
      name: safeOriginalName(attachment.name, index, extension),
      mimeType,
      extension,
      data,
    };
  });
}
