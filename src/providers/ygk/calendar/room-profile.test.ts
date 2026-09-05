import { describe, expect, it } from 'vitest';
import type {
  CalendarProfile,
  CalendarRoomProfiles,
} from '../../../calendar/config.ts';
import {
  createYgkRoomTimeResolver,
  parseYgkRoomLocation,
} from './room-profile.ts';

const profiles: Record<string, CalendarProfile> = {
  'a-m': {
    lessonTimes: {
      2: { start: '11:00', end: '11:45' },
      3: { start: '13:20', end: '14:50' },
    },
    lessonTimesByDay: {},
  },
  'b-v': {
    lessonTimes: { 2: { start: '11:00', end: '12:30' } },
    lessonTimesByDay: {},
  },
  't-year-1': {
    lessonTimes: { 2: { start: '11:00', end: '11:45' } },
    lessonTimesByDay: {},
  },
  't-years-2-4': {
    lessonTimes: { 2: { start: '11:00', end: '12:30' } },
    lessonTimesByDay: {},
  },
  'f-year-1': {
    lessonTimes: { 2: { start: '11:00', end: '11:45' } },
    lessonTimesByDay: {},
  },
  'f-years-2-4': {
    lessonTimes: { 2: { start: '11:00', end: '12:30' } },
    lessonTimesByDay: {},
  },
};

const roomProfiles: CalendarRoomProfiles = {
  buildings: {
    А: { profile: 'a-m', courseProfiles: {}, groupOverrides: {} },
    М: { profile: 'a-m', courseProfiles: {}, groupOverrides: {} },
    Б: { profile: 'b-v', courseProfiles: {}, groupOverrides: {} },
    В: { profile: 'b-v', courseProfiles: {}, groupOverrides: {} },
    Т: {
      courseProfiles: {
        1: 't-year-1',
        2: 't-years-2-4',
        3: 't-years-2-4',
        4: 't-years-2-4',
      },
      groupOverrides: {},
    },
    Ф: {
      courseProfiles: { 2: 'f-years-2-4', 3: 'f-years-2-4', 4: 'f-years-2-4' },
      groupOverrides: { 'ЮР1-11': 'f-year-1' },
    },
  },
  specialRooms: {
    ДОТ: { kind: 'remote' },
    РОТ: { kind: 'unknown' },
    'СПОРТ КОРПУС': { kind: 'sport' },
    СПОРТЗАЛ: { kind: 'sport', profile: 'a-m' },
    'СП.ЗАЛ': { kind: 'sport', profile: 'a-m' },
    'СПОРТ.ЗАЛ': { kind: 'sport', profile: 'a-m' },
  },
};

describe('YGK room profile resolver', () => {
  it('recognizes only numbered physical rooms as buildings', () => {
    expect(
      parseYgkRoomLocation('каб. А 203', roomProfiles.specialRooms),
    ).toMatchObject({
      kind: 'physical',
      building: 'А',
    });
    expect(
      parseYgkRoomLocation('каб. Б-504', roomProfiles.specialRooms),
    ).toMatchObject({
      kind: 'physical',
      building: 'Б',
    });
    expect(
      parseYgkRoomLocation('Спорт корпус', roomProfiles.specialRooms).kind,
    ).toBe('sport');
    expect(
      parseYgkRoomLocation('Сп.зал', roomProfiles.specialRooms),
    ).toMatchObject({
      kind: 'sport',
      profile: 'a-m',
    });
    expect(
      parseYgkRoomLocation('Спорт.зал', roomProfiles.specialRooms),
    ).toMatchObject({
      kind: 'sport',
      profile: 'a-m',
    });
    expect(parseYgkRoomLocation('ДОТ', roomProfiles.specialRooms).kind).toBe(
      'remote',
    );
    expect(parseYgkRoomLocation('РОТ', roomProfiles.specialRooms).kind).toBe(
      'unknown',
    );
  });

  it('uses the lesson room first and group only for the required T/F refinement', () => {
    const resolve = createYgkRoomTimeResolver(profiles, roomProfiles);
    expect(
      resolve({
        group: 'СТ1-11',
        day: 'Понедельник',
        lessonNumber: 2,
        room: 'Б504',
      }),
    ).toMatchObject({ profile: 'b-v', slots: [{ end: '12:30' }] });
    expect(
      resolve({
        group: 'СТ1-11',
        day: 'Понедельник',
        lessonNumber: 2,
        room: 'Т101',
      }),
    ).toMatchObject({ profile: 't-year-1', slots: [{ end: '11:45' }] });
    expect(
      resolve({
        group: 'ЮР1-11',
        day: 'Понедельник',
        lessonNumber: 2,
        room: 'Ф101',
      }),
    ).toMatchObject({ profile: 'f-year-1', slots: [{ end: '11:45' }] });
  });

  it('does not guess time for an unconfirmed location or F first-year group', () => {
    const resolve = createYgkRoomTimeResolver(profiles, roomProfiles);
    expect(
      resolve({
        group: 'СТ1-11',
        day: 'Понедельник',
        lessonNumber: 2,
        room: 'ДОТ',
      }),
    ).toMatchObject({ slots: [] });
    expect(
      resolve({
        group: 'СТ1-11',
        day: 'Понедельник',
        lessonNumber: 2,
        room: 'Ф101',
      }),
    ).toMatchObject({ slots: [] });
  });

  it('uses the configured sport hall profile for known spelling variants', () => {
    const resolve = createYgkRoomTimeResolver(profiles, roomProfiles);
    expect(
      resolve({
        group: 'СД2-31',
        day: 'Суббота',
        lessonNumber: 3,
        room: 'Сп.зал',
      }),
    ).toMatchObject({
      profile: 'a-m',
      slots: [{ start: '13:20', end: '14:50' }],
    });
  });
});
