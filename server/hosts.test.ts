import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { avatarEnvName, avatarFor, hostNameOf } from './hosts.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('every app names its host the same way', () => {
  test('each app folder has an avatar.json with its host avatar and name', () => {
    const dirs = readdirSync('apps', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs).toEqual(expect.arrayContaining(['training', 'recruiter', 'presence', 'game', 'livestream', 'chess-opponent']));
    for (const dir of dirs) {
      const host = JSON.parse(readFileSync(`apps/${dir}/avatar.json`, 'utf8'));
      expect(host.avatarId, dir).toMatch(UUID);
      expect(host.name, dir).toBeTruthy();
    }
  });

  test('the five classic apps read theirs from avatar.json, as the mini-apps do', () => {
    const kin = JSON.parse(readFileSync('apps/presence/avatar.json', 'utf8'));
    expect(avatarFor('presence')).toBe(kin.avatarId);
    expect(hostNameOf('presence')).toBe('Kin');
  });
});

describe('the environment still swaps a host without a commit', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('AVATAR_<APP_ID> wins over avatar.json', () => {
    process.env.AVATAR_PRESENCE = 'override-id';
    expect(avatarFor('presence')).toBe('override-id');
    process.env.AVATAR_CHESS_OPPONENT = 'other-id';
    expect(avatarFor('chess-opponent')).toBe('other-id');
  });

  test('AVATAR_DEFAULT serves an app with no host of its own, and nothing is ""', () => {
    delete process.env.AVATAR_DEFAULT;
    expect(avatarFor('no-such-app')).toBe('');
    process.env.AVATAR_DEFAULT = 'default-id';
    expect(avatarFor('no-such-app')).toBe('default-id');
    expect(avatarFor('presence')).not.toBe('default-id');
  });

  test('the variable is the app id upper-cased, dashes as underscores', () => {
    expect(avatarEnvName('chess-opponent')).toBe('AVATAR_CHESS_OPPONENT');
    expect(avatarEnvName('presence')).toBe('AVATAR_PRESENCE');
  });
});
