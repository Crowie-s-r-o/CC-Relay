import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeImageAttachments,
  MAX_IMAGE_ATTACHMENTS,
} from '../src/attachments.mjs';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('image attachments decode validated local image data', () => {
  const [attachment] = decodeImageAttachments([{
    name: '../reference.png',
    mimeType: 'image/png',
    data: `data:image/png;base64,${ONE_PIXEL_PNG}`,
  }]);

  assert.equal(attachment.name, 'reference.png');
  assert.equal(attachment.mimeType, 'image/png');
  assert.equal(attachment.extension, 'png');
  assert.equal(Buffer.isBuffer(attachment.data), true);
  assert.equal(attachment.data.length > 8, true);
});

test('image attachments reject spoofed files and excessive counts', () => {
  assert.throws(() => decodeImageAttachments([{
    name: 'fake.png',
    mimeType: 'image/png',
    data: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`,
  }]), /does not match/);

  assert.throws(
    () => decodeImageAttachments(Array.from({ length: MAX_IMAGE_ATTACHMENTS + 1 }, () => ({}))),
    /Attach at most/,
  );
});
