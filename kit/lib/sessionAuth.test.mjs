import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageNeedsPerson } from './signInPause.mjs';

describe('sessionAuth gate signals', () => {
  it('treats a visible password form as needing a person (or auto credentials)', () => {
    assert.equal(pageNeedsPerson({ text: 'Sign in', url: 'https://app.example/login', hasPassword: true }), true);
    assert.equal(pageNeedsPerson({ text: 'Welcome', url: 'https://app.example/dashboard', hasPassword: false }), false);
  });
});
