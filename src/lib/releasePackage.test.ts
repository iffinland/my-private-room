import { describe, expect, it } from 'vitest';
import {
  APP_ENTRY_FILE,
  assertAppPackageEntries,
  createStoredZip,
  crc32,
  normalizePackagePath,
  readStoredZip,
  ReleasePackageError,
} from './releasePackage';
import { extractEntryAssetPaths } from './releaseArtifact';

const encode = (value: string) => new TextEncoder().encode(value);

const sampleEntries = () => [
  { path: 'assets/index-ABC.js', data: encode('console.log("app");') },
  { path: './favicon.svg', data: encode('<svg></svg>') },
  { path: 'index.html', data: encode('<script type="module" src="./assets/index-ABC.js"></script>') },
];

describe('createStoredZip', () => {
  it('round-trips a build tree with index.html at the package root', () => {
    const zip = createStoredZip(sampleEntries());
    const entries = readStoredZip(zip);

    expect(entries.map((entry) => entry.path)).toEqual([
      'assets/index-ABC.js',
      'favicon.svg',
      'index.html',
    ]);
    expect(new TextDecoder().decode(entries.find((entry) => entry.path === 'index.html')!.data)).toContain(
      'assets/index-ABC.js',
    );
    expect([...entries.find((entry) => entry.path === 'favicon.svg')!.data]).toEqual([
      ...encode('<svg></svg>'),
    ]);
  });

  it('is byte-reproducible for identical content', () => {
    expect(createStoredZip(sampleEntries())).toEqual(createStoredZip(sampleEntries()));
  });

  it('keeps a dist/ wrapper visible so the release gate can reject it', () => {
    const zip = createStoredZip([
      { path: 'dist/index.html', data: encode('<html></html>') },
      { path: 'dist/assets/index-ABC.js', data: encode('x') },
    ]);

    expect(readStoredZip(zip).map((entry) => entry.path)).toEqual([
      'dist/assets/index-ABC.js',
      'dist/index.html',
    ]);
    expect(() => assertAppPackageEntries(readStoredZip(zip).map((entry) => entry.path))).toThrow(
      ReleasePackageError,
    );
  });

  it('rejects unsafe or duplicate paths', () => {
    expect(() => createStoredZip([{ path: '../index.html', data: encode('x') }])).toThrow();
    expect(() =>
      createStoredZip([
        { path: 'index.html', data: encode('a') },
        { path: './index.html', data: encode('b') },
      ]),
    ).toThrow(/Duplicate/);
  });
});

describe('assertAppPackageEntries', () => {
  it('accepts the realistic production build layout', () => {
    const paths = [
      'assets/01-mountains.jpg',
      'assets/index-B5.css',
      'assets/index-C4.js',
      'assets/pdf.worker.min.mjs',
      'assets/thumbnailPdf.js',
      'favicon.svg',
      'index.html',
    ];

    expect(assertAppPackageEntries(paths)).toEqual(paths);
  });

  it('rejects a nested dist/ entry point', () => {
    expect(() => assertAppPackageEntries(['dist/index.html', 'dist/assets/app.js'])).toThrow(
      /index\.html below a wrapper directory/,
    );
  });

  it('rejects a package without a root index.html', () => {
    expect(() => assertAppPackageEntries(['assets/app.js', 'favicon.svg'])).toThrow(
      /no top-level index\.html/,
    );
  });

  it('rejects the opaque single-ZIP shape reported by the live resource', () => {
    expect(() => assertAppPackageEntries(['dist-katalog.zip'])).toThrow(/no top-level index\.html/);
  });
});

describe('package layout matches the assets referenced by index.html', () => {
  it('finds every referenced script, stylesheet and icon in the package', () => {
    const html = `
      <base href="/render/APP/My%20File%20Office/myfileoffice/">
      <script src="/apps/q-apps.js?time=1"></script>
      <script type="module" src="./assets/index-C4.js"></script>
      <link rel="stylesheet" href="./assets/index-B5.css">
      <link rel="icon" href="./favicon.svg">
    `;
    const paths = assertAppPackageEntries(['favicon.svg', 'index.html', 'assets/index-C4.js', 'assets/index-B5.css']);
    const referenced = extractEntryAssetPaths(html);

    expect(referenced).toEqual(['assets/index-B5.css', 'assets/index-C4.js', 'favicon.svg']);
    for (const asset of referenced) expect(paths).toContain(asset);
  });
});

describe('normalizePackagePath and crc32', () => {
  it('normalizes separators and leading markers', () => {
    expect(normalizePackagePath('.\\assets\\app.js')).toBe('assets/app.js');
    expect(normalizePackagePath('/index.html')).toBe('index.html');
  });

  it('computes the standard CRC-32 of "123456789"', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
  });

  it('uses the same root entry constant as the live classification', () => {
    expect(APP_ENTRY_FILE).toBe('index.html');
  });
});
