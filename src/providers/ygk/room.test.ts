import { describe, expect, it } from 'vitest';
import { normalizeYgkRoom } from './room.ts';

describe('YGK room normalization', () => {
  it.each([
    ['к 25', 'к.25'],
    ['к.21', 'к.21'],
    ['каб 101', 'к.101'],
    ['А 203', 'А 203'],
    ['спортзал', 'спортзал'],
  ])('normalizes %s', (rawRoom, room) => {
    expect(normalizeYgkRoom(rawRoom)).toBe(room);
  });
});
