import { describe, expect, it } from 'vitest';
import {
  APP_ENTRY_FILE,
  classifyPublishedApp,
  compareEntryAssets,
  extractEntryAssetPaths,
  normalizePublishedFiles,
  normalizePublishedPath,
} from './releaseArtifact';

describe('normalizePublishedPath', () => {
  it('normalizes separators and leading relative markers', () => {
    expect(normalizePublishedPath('.\\assets\\index.js')).toBe('assets/index.js');
    expect(normalizePublishedPath('/index.html')).toBe('index.html');
    expect(normalizePublishedPath('  ./index.html  ')).toBe('index.html');
  });
});

describe('normalizePublishedFiles', () => {
  it('keeps only usable string entries', () => {
    expect(normalizePublishedFiles(['index.html', '', null, 42, '..', 'assets/app.js'])).toEqual([
      'index.html',
      'assets/app.js',
    ]);
  });

  it('returns an empty list for a non-array value', () => {
    expect(normalizePublishedFiles(undefined)).toEqual([]);
    expect(normalizePublishedFiles('index.html')).toEqual([]);
  });
});

describe('classifyPublishedApp', () => {
  it('detects the live 404 cause: one ZIP published as a file', () => {
    const shape = classifyPublishedApp(['myfileoffice.zip']);
    expect(shape.status).toBe('opaque-archive');
    expect(shape.message).toContain('HTTP 404');
    expect(shape.message).toContain('myfileoffice.zip');
  });

  it('accepts an unpacked directory resource', () => {
    const shape = classifyPublishedApp(['assets/index.js', 'index.html', 'favicon.svg']);
    expect(shape.status).toBe('directory');
    expect(shape.files).toContain(APP_ENTRY_FILE);
  });

  it('rejects a nested entry point', () => {
    expect(classifyPublishedApp(['dist/index.html', 'dist/assets/index.js']).status).toBe(
      'missing-entry',
    );
  });

  it('reports an unknown shape when metadata has no file list', () => {
    expect(classifyPublishedApp([]).status).toBe('unknown');
    expect(classifyPublishedApp(undefined).status).toBe('unknown');
  });

  it('treats a non-ZIP single file as a missing entry point', () => {
    expect(classifyPublishedApp(['index.htm']).status).toBe('missing-entry');
  });
});

describe('extractEntryAssetPaths', () => {
  it('collects only release-relative assets', () => {
    const html = `
      <base href="/render/APP/Example/example/">
      <script src="/apps/q-apps.js?time=1"></script>
      <script type="module" src="./assets/index-ABC.js"></script>
      <link rel="stylesheet" href="./assets/index-DEF.css">
      <link rel="icon" href="./favicon.svg">
      <a href="https://example.com/x.js">x</a>
      <img src="data:image/png;base64,AAAA">
      <a href="#section">section</a>
    `;

    expect(extractEntryAssetPaths(html)).toEqual([
      'assets/index-ABC.js',
      'assets/index-DEF.css',
      'favicon.svg',
    ]);
  });

  it('strips query strings and fragments from local references', () => {
    expect(extractEntryAssetPaths('<script src="./assets/app.js?v=1"></script>')).toEqual([
      'assets/app.js',
    ]);
  });
});

describe('compareEntryAssets', () => {
  const local = `
    <script type="module" crossorigin src="./assets/index-C4iHl5CR.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-B5Gyq3jI.css">
  `;

  it('matches when the served bundle names are the same', () => {
    const served = `
      <base href="/render/APP/My%20File%20Office/myfileoffice/">
      <script src="/apps/q-apps.js?time=1"></script>
      <script type="module" src="./assets/index-C4iHl5CR.js"></script>
      <link rel="stylesheet" href="./assets/index-B5Gyq3jI.css">
    `;

    expect(compareEntryAssets(local, served)).toMatchObject({
      matches: true,
      missingFromServed: [],
      unexpectedInServed: [],
    });
  });

  it('reports deployment drift in both directions', () => {
    const served = '<script src="./assets/index-OLD.js"></script>';
    const comparison = compareEntryAssets(local, served);

    expect(comparison.matches).toBe(false);
    expect(comparison.missingFromServed).toEqual([
      'assets/index-B5Gyq3jI.css',
      'assets/index-C4iHl5CR.js',
    ]);
    expect(comparison.unexpectedInServed).toEqual(['assets/index-OLD.js']);
  });
});
