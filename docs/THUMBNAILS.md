# Thumbnail generation and limits

All thumbnails are generated client-side in the browser that runs the app. No
VPS-side rendering, external image service or uploaded original is required.

## Bounds

| Bound | Value |
| --- | --- |
| Maximum output dimensions | 512 × 384 px |
| Maximum output size | 300 KiB |
| Preferred encoding | WebP when the canvas supports it, otherwise JPEG |
| Maximum image source | 80 MiB |
| Maximum PDF source | 32 MiB |
| Text preview read | first 8 KiB |
| Image decode timeout | 15 s |
| Video frame/seek timeout | 12 s |
| PDF render timeout | 20 s |

Large images are cropped to a 4:3 cover box (not stretched), downscaled with
high-quality smoothing, then re-encoded at decreasing quality and, if needed,
smaller dimensions until they fit the byte budget. Sources that cannot be
decoded are not retried and produce no QDN resource.

## Supported sources

| Source | Result |
| --- | --- |
| `image/*` (decodable by the browser) | Cropped cover image from the image content |
| `video/*` (codec supported by the browser) | Frame captured at ~10% of duration, capped to 5 s, drawn as a 16:9/4:3 cover |
| Text-like files | Readable excerpt on a styled card with filename, type and size |
| PDF | First page rendered through the lazy-loaded pdf.js worker |
| Custom image | User-selected image normalized to the same bounds |

Text-like detection covers `text/*`, JSON, XML, JavaScript, YAML and common
source/document extensions. The excerpt is capped at 17 lines.

## Custom thumbnails

The publish form accepts an image file, decodes it, and re-encodes it to the same
bound as an automatic thumbnail. SVG and other formats the browser cannot decode
safely are rejected and the automatic/fallback state is kept.

## Fallback behavior

When generation is unsupported, fails, times out, or the source is too large:

- no thumbnail resource is published;
- the file card renders a file-type icon (document, image, video, audio,
  archive, or generic file) on the themed card background;
- legacy files without a thumbnail also use the icon;
- the publish form reports why generation was skipped and still allows
  publishing the file.

## Browser and format limitations

- **Canvas is required.** Very old or heavily sandboxed WebViews without canvas
  cannot render thumbnails; the app falls back to icons.
- **Video frame capture is codec-dependent.** MP4/H.264/WebM are commonly
  supported; MOV/ProRes, HEVC, DRM-protected media and some containers are not
  decodable by the browser even when the file preview can play later in a native
  viewer.
- **PDF rendering requires pdf.js assets.** The worker is bundled into `dist`,
  so it works offline inside QDN, but the initial PDF preview chunk is loaded
  lazily (about 365 KiB plus the 1.38 MiB worker) only when a PDF thumbnail is
  requested.
- **Animated/vector formats.** GIF produces a static frame; SVG is not decoded
  by the custom-thumbnail path.
- **Huge images.** Above the 80 MiB source bound the app skips generation rather
  than risk an out-of-memory decode.
- **EXIF orientation.** Modern browsers apply image orientation through
  `createImageBitmap(..., { imageOrientation: 'from-image' })`; older decoders
  fall back to an `<img>` element.
- **Color profiles** are not explicitly normalized; the browser's canvas
  converts to sRGB.
- **No server-side fallback.** If the browser cannot produce a preview, the app
  deliberately publishes no thumbnail instead of spending QDN storage on a
  possibly broken image.
