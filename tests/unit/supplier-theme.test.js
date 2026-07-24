'use strict';

const {
  buildSupplierThemeMutation,
  normaliseStoredSupplierTheme,
  resolveSupplierTheme,
} = require('../../utils/supplierTheme');

describe('supplier theme state', () => {
  test('normalises stored modes and removes stale competing values', () => {
    expect(
      normaliseStoredSupplierTheme({
        themeMode: 'preset',
        heroPreset: 'midnight',
        themeColor: '#ff0000',
      })
    ).toEqual({ themeMode: 'preset', themeColor: null, heroPreset: 'midnight' });

    expect(
      normaliseStoredSupplierTheme({
        themeMode: 'custom',
        heroPreset: 'midnight',
        themeColor: '#ec4899',
      })
    ).toEqual({ themeMode: 'custom', themeColor: '#EC4899', heroPreset: null });
  });

  test('makes preset, custom and automatic mutations mutually exclusive', () => {
    expect(
      buildSupplierThemeMutation(
        { themeMode: 'preset', heroPreset: 'midnight', themeColor: '#ec4899' },
        {}
      )
    ).toEqual({
      set: { themeMode: 'preset', heroPreset: 'midnight' },
      unset: { themeColor: 1 },
    });

    expect(
      buildSupplierThemeMutation(
        { themeMode: 'custom', themeColor: '#ec4899' },
        { heroPreset: 'midnight' }
      )
    ).toEqual({
      set: { themeMode: 'custom', themeColor: '#EC4899' },
      unset: { heroPreset: 1 },
    });

    expect(
      buildSupplierThemeMutation(
        { themeMode: 'automatic' },
        { heroPreset: 'midnight', themeColor: '#ec4899' }
      )
    ).toEqual({
      set: { themeMode: 'automatic' },
      unset: { themeColor: 1, heroPreset: 1 },
    });
  });

  test('keeps legacy owner-editor preset payloads aligned', () => {
    expect(
      buildSupplierThemeMutation(
        { heroPreset: 'midnight', themeColor: '#0B8073' },
        { category: 'Photography' }
      )
    ).toEqual({
      set: { themeMode: 'preset', heroPreset: 'midnight' },
      unset: { themeColor: 1 },
    });
  });

  test('accepts the legacy owner-editor custom-colour payload shape', () => {
    expect(
      buildSupplierThemeMutation(
        { heroPreset: '', themeColor: '#ec4899' },
        { themeMode: 'preset', heroPreset: 'midnight' }
      )
    ).toEqual({
      set: { themeMode: 'custom', themeColor: '#EC4899' },
      unset: { heroPreset: 1 },
    });
  });

  test('does not let the legacy customisation page silently replace automatic themes with teal', () => {
    expect(
      buildSupplierThemeMutation({ themeColor: '#0B8073' }, { category: 'Photography' })
    ).toEqual({
      set: { themeMode: 'automatic' },
      unset: { heroPreset: 1, themeColor: 1 },
    });
  });

  test('does not let the legacy customisation page silently replace a preset with teal', () => {
    expect(
      buildSupplierThemeMutation(
        { themeColor: '#0B8073' },
        { themeMode: 'preset', heroPreset: 'midnight', category: 'Photography' }
      )
    ).toEqual({
      set: { themeMode: 'preset' },
      unset: { themeColor: 1 },
    });
  });

  test('covers canonical supplier categories with visual families', () => {
    expect(resolveSupplierTheme({ category: 'Music/DJ' })).toMatchObject({
      source: 'category',
      accent: '#6A0DAD',
    });
    expect(resolveSupplierTheme({ category: 'Videography' })).toMatchObject({
      source: 'category',
      accent: '#1A3A5C',
    });
    expect(resolveSupplierTheme({ category: 'Hair & Makeup' })).toMatchObject({
      source: 'category',
      accent: '#9D174D',
    });
  });

  test('rejects invalid explicit theme state', () => {
    expect(
      buildSupplierThemeMutation({ themeMode: 'preset', heroPreset: 'unknown' }, {})
    ).toMatchObject({
      error: 'A valid hero preset is required for preset theme mode',
    });
    expect(
      buildSupplierThemeMutation({ themeMode: 'custom', themeColor: 'red' }, {})
    ).toMatchObject({
      error: 'A valid six-digit hex colour is required for custom theme mode',
    });
  });
});
