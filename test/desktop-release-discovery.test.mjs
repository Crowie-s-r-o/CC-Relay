import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_RELEASE_API_URL,
  createGitHubReleaseChecker,
  isNewerDesktopRelease,
} from '../src/desktop-release-discovery.mjs';

test('compares stable desktop release versions numerically', () => {
  assert.equal(isNewerDesktopRelease('1.2.0', '1.1.9'), true);
  assert.equal(isNewerDesktopRelease('2.0.0', '1.99.99'), true);
  assert.equal(isNewerDesktopRelease('1.2.0', '1.2.0'), false);
  assert.equal(isNewerDesktopRelease('1.1.9', '1.2.0'), false);
  assert.equal(isNewerDesktopRelease('1.2', '1.1.9'), false);
});

test('reads the latest stable release from the fixed GitHub API endpoint', async () => {
  const requests = [];
  const checker = createGitHubReleaseChecker({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            tag_name: 'v1.2.3',
            draft: false,
            prerelease: false,
            body: '### Added\n\n- A clearer update dialog.',
          };
        },
      };
    },
  });
  assert.deepEqual(await checker(), {
    version: '1.2.3',
    releaseUrl: 'https://github.com/Crowie-s-r-o/CC-Relay/releases/tag/v1.2.3',
    releaseNotes: '### Added\n\n- A clearer update dialog.',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, DESKTOP_RELEASE_API_URL);
  assert.equal(requests[0].options.headers.accept, 'application/vnd.github+json');
  assert.match(requests[0].options.headers['user-agent'], /CC-Relay/);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('rejects unavailable or unstable GitHub release metadata', async () => {
  const unavailable = createGitHubReleaseChecker({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(unavailable(), /HTTP 503/);

  const prerelease = createGitHubReleaseChecker({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { tag_name: 'v1.3.0', prerelease: true };
      },
    }),
  });
  await assert.rejects(prerelease(), /not a stable CC Relay version/);
});
