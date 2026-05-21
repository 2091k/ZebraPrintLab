import { useState, useRef, useCallback } from 'react';
import { InformationCircleIcon, TrashIcon } from '@heroicons/react/16/solid';
import type { ObjectTypeDefinition } from '../types/ObjectType';
import { useT } from '../lib/useT';
import { buttonCls, inputCls, labelCls } from '../components/Properties/styles';
import { fieldPos } from './zplHelpers';
import { loadImageFile, getImage, getAllImages, removeImage } from '../lib/imageCache';
import { imageToGFA } from '../lib/imageToZpl';
import {
  defaultStorageName,
  formatStoragePath,
  MAX_STORAGE_NAME_LEN,
  STORAGE_DEVICES,
  STORAGE_NAME_FILTER_RE,
  type StorageDevice,
} from '../lib/storagePath';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export interface ImageProps {
  /** ID into the image cache */
  imageId: string;
  /** Target width in dots (height derived from aspect ratio when a cached
   *  PNG is available; falls back to `heightDots` for recall-only
   *  placeholders). */
  widthDots: number;
  /** Override height for placeholder/recall-only images that have no
   *  cached bytes — without it the box would snap to a fixed default
   *  and ignore the user's drag. Only consulted when `imageId` does
   *  not resolve to a cached image. */
  heightDots?: number;
  /** Luminance threshold for mono conversion (0–255) */
  threshold: number;
  /** Cached GFA ZPL string — regenerated when image/width/threshold changes */
  _gfaCache?: string;
  /** When set, the image is uploaded once via `~DY` (preamble) and referenced
   *  per-instance via `^XG`. Set by the parser when a ZPL stream uses the
   *  upload+recall pattern, preserved on re-export. Without this the image
   *  emits inline `^GF` as before. */
  storedAs?: {
    /** Storage device prefix without trailing colon: "R", "E", "B", or "A". */
    device: string;
    /** Filename stem (no extension); paired with `.GRF` for graphics. */
    name: string;
    /** Ship the bitmap bytes via `~DY` alongside the `^XG` reference.
     *  Default true on first toggle so a single-job ZPL is self-contained.
     *  False = recall-only: assume the file is already on printer storage,
     *  emit only `^XG`. Mirrors the customFonts `embedInZpl` pattern. */
    embedInZpl?: boolean;
  };
}

/** Synchronously generate ^GFA using a blocking canvas (for toZPL). */
function gfaSync(dataUrl: string, widthDots: number, threshold: number): string {
  const img = new Image();
  // data-URL loads synchronously when set on an already-created Image
  img.src = dataUrl;
  // In some browsers this might not be immediate for large images,
  // but for data-URLs it's synchronous.
  if (!img.complete || !img.naturalWidth) return '';

  const aspect = img.naturalHeight / img.naturalWidth;
  const heightDots = Math.max(1, Math.round(widthDots * aspect));
  const bytesPerRow = Math.ceil(widthDots / 8);
  const paddedWidth = bytesPerRow * 8;

  const canvas = document.createElement('canvas');
  canvas.width = paddedWidth;
  canvas.height = heightDots;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, paddedWidth, heightDots);
  ctx.drawImage(img, 0, 0, widthDots, heightDots);

  const pixels = ctx.getImageData(0, 0, paddedWidth, heightDots).data;
  const totalBytes = bytesPerRow * heightDots;
  const hexChars: string[] = [];

  for (let row = 0; row < heightDots; row++) {
    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = byteIdx * 8 + bit;
        const idx = (row * paddedWidth + px) * 4;
        const lum = 0.299 * (pixels[idx] ?? 255) + 0.587 * (pixels[idx + 1] ?? 255) + 0.114 * (pixels[idx + 2] ?? 255);
        if (lum < threshold) byte |= (0x80 >> bit);
      }
      hexChars.push(byte.toString(16).toUpperCase().padStart(2, '0'));
    }
  }

  return `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hexChars.join('')}`;
}

export const image: ObjectTypeDefinition<ImageProps> = {
  label: 'Image',
  icon: 'img',
  group: 'shape',
  defaultProps: {
    imageId: '',
    widthDots: 200,
    threshold: 128,
  },
  defaultSize: { width: 200, height: 200 },

  // Resize via canvas-handle:
  //  - With cached PNG → aspect locked, height re-derives from widthDots.
  //    Pick the dominant scale (largest deviation from 1) so all eight
  //    handles work for both grow and shrink. Math.max would mis-handle
  //    inward single-axis drags (sx=0.5, sy=1 → max=1 → no change).
  //  - Without cache (recall-only placeholder) → free-form. widthDots
  //    and heightDots scale independently so the user can shape the
  //    placeholder box for layout purposes.
  // _gfaCache always cleared — for cached images the hex needs regen at
  // the new width; for placeholders it's empty anyway.
  commitTransform: (obj, ctx) => {
    const { sx, sy, snap } = ctx;
    const cached = getImage(obj.props.imageId);
    const widthDots = (scale: number): number =>
      Math.max(8, snap(Math.round(obj.props.widthDots * scale)));
    if (cached) {
      const dominant = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      return { widthDots: widthDots(dominant), _gfaCache: undefined };
    }
    // First-resize fallback for heightDots: use the current widthDots so
    // the implicit default (square placeholder) matches what the canvas
    // renders before the user has dragged. Drifting from that — e.g. a
    // hard-coded 200 — would mean the first drag visibly snaps the box.
    const baseHeight = obj.props.heightDots ?? obj.props.widthDots;
    return {
      widthDots: widthDots(sx),
      heightDots: Math.max(8, snap(Math.round(baseHeight * sy))),
      _gfaCache: undefined,
    };
  },

  toZPL: (obj) => {
    const p = obj.props;
    // Recall path: upload happened in the preamble; here we just reference
    // it via ^XG. The `.GRF` extension is implicit on `~DY{path},A,G,…` —
    // Zebra firmware persists the file as `path.GRF` and `^XG` resolves
    // the dot-suffixed form.
    if (p.storedAs) {
      return `${fieldPos(obj)}^XG${formatStoragePath(p.storedAs, true)},1,1^FS`;
    }
    const cached = getImage(p.imageId);
    if (!cached) return `${fieldPos(obj)}^FD^FS`;
    // Use cached GFA if available, otherwise generate synchronously
    const gfa = p._gfaCache || gfaSync(cached.dataUrl, p.widthDots, p.threshold);
    return `${fieldPos(obj)}${gfa}^FS`;
  },

  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadFailed, setUploadFailed] = useState(false);
    const [pendingCacheDelete, setPendingCacheDelete] = useState(false);

    const cached = getImage(p.imageId);
    const allImages = getAllImages();

    const handleUpload = useCallback(async (file: File) => {
      setUploading(true);
      setUploadFailed(false);
      try {
        const entry = await loadImageFile(file);
        // Pre-generate GFA cache
        const result = await imageToGFA(entry.dataUrl, p.widthDots, p.threshold);
        onChange({ imageId: entry.id, _gfaCache: result.zpl });
      } catch {
        // Surface the failure inline (non-image MIME, oversized file, decode
        // error, GFA exception) and stop. The codebase has no production
        // logging path; debugging specific causes (e.g. an obscure MIME) is
        // done with a devtools breakpoint on this catch.
        setUploadFailed(true);
      } finally {
        setUploading(false);
      }
    }, [onChange, p.widthDots, p.threshold]);

    const handleImageSelect = useCallback(async (imageId: string) => {
      // Empty selection = "no image bytes". Legitimate when the user is
      // setting up a recall-only reference (storedAs without a local
      // preview image). Clear the cache pointer + ^GFA cache so the
      // ZPL emitter doesn't carry stale bytes from the previous source.
      if (!imageId) {
        onChange({ imageId: '', _gfaCache: undefined });
        return;
      }
      const img = getImage(imageId);
      if (!img) return;
      const result = await imageToGFA(img.dataUrl, p.widthDots, p.threshold);
      onChange({ imageId, _gfaCache: result.zpl });
    }, [onChange, p.widthDots, p.threshold]);

    const handleWidthChange = useCallback(async (widthDots: number) => {
      const img = getImage(p.imageId);
      if (!img) { onChange({ widthDots }); return; }
      const result = await imageToGFA(img.dataUrl, widthDots, p.threshold);
      onChange({ widthDots, _gfaCache: result.zpl });
    }, [onChange, p.imageId, p.threshold]);

    const handleThresholdChange = useCallback(async (threshold: number) => {
      const img = getImage(p.imageId);
      if (!img) { onChange({ threshold }); return; }
      const result = await imageToGFA(img.dataUrl, p.widthDots, threshold);
      onChange({ threshold, _gfaCache: result.zpl });
    }, [onChange, p.imageId, p.widthDots]);

    // Lifted local const so the storage-section closures get a narrowed
    // reference that survives into onChange callbacks. Without it TS
    // re-widens `p.storedAs` to `... | undefined` inside the handlers
    // and we'd need `?.`-fallbacks for every field access.
    const storedAs = p.storedAs;

    return (
      <div className="flex flex-col gap-3">
        {/* Image select / upload */}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.registry.image.source}</label>
          {allImages.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                className={`${inputCls} flex-1`}
                value={p.imageId}
                onChange={(e) => handleImageSelect(e.target.value)}
              >
                <option value="">{t.registry.image.selectImage}</option>
                {allImages.map((img) => (
                  <option key={img.id} value={img.id}>{img.name}</option>
                ))}
              </select>
              {/* Delete the *cached* file (data-URL) from imageCache +
                  localStorage. Different from removing the image-object
                  via Del: this clears the bytes shared across all
                  objects referencing the same imageId. Skip when the
                  current image-object has no source selected. */}
              {p.imageId && (
                <button
                  type="button"
                  className="p-1.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors shrink-0"
                  title={t.registry.image.removeFromCache}
                  onClick={() => setPendingCacheDelete(true)}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className={buttonCls}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? t.registry.image.uploading : t.registry.image.upload}
          </button>
          {uploadFailed && (
            <p className="text-[10px] font-mono text-red-400">{t.registry.image.uploadError}</p>
          )}
        </div>

        {/* Preview thumbnail */}
        {cached && (
          <div className="flex flex-col gap-1">
            <label className={labelCls}>{t.registry.image.preview}</label>
            <img
              src={cached.dataUrl}
              alt={cached.name}
              className="max-w-full max-h-20 object-contain rounded border border-border bg-white"
            />
            <span className="text-[10px] text-muted font-mono">
              {cached.width} × {cached.height} px
            </span>
          </div>
        )}

        {/* Width in dots */}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.registry.image.widthDots}</label>
          <input
            type="number"
            className={inputCls}
            value={p.widthDots}
            min={8}
            step={8}
            onChange={(e) => handleWidthChange(Number(e.target.value))}
          />
        </div>

        {/* Mono threshold */}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.registry.image.threshold}</label>
          <input
            type="range"
            min={1}
            max={255}
            value={p.threshold}
            onChange={(e) => handleThresholdChange(Number(e.target.value))}
            className="accent-accent"
          />
          <span className="text-[10px] text-muted font-mono text-right">{p.threshold}</span>
        </div>

        {/* Printer storage (~DY + ^XG). Section label + info icon are
            always visible so the feature is discoverable in both states;
            the body switches between an Activate-button (off) and the
            device/name editor (on). Border-top separates it visually
            from the rendering properties above. */}
        <div className="flex flex-col gap-1 mt-1 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <label className={labelCls}>{t.registry.image.storage}</label>
            <InformationCircleIcon
              className="w-3 h-3 text-muted/60 cursor-help shrink-0"
              title={t.registry.image.storeOnPrinterHint}
            />
          </div>
          {storedAs ? (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <select
                  className={inputCls}
                  value={storedAs.device}
                  onChange={(e) =>
                    onChange({
                      storedAs: {
                        device: e.target.value as StorageDevice,
                        name: storedAs.name,
                      },
                    })
                  }
                >
                  {STORAGE_DEVICES.map((d) => (
                    <option key={d} value={d}>{d}:</option>
                  ))}
                </select>
                <input
                  className={inputCls}
                  value={storedAs.name}
                  maxLength={MAX_STORAGE_NAME_LEN}
                  onChange={(e) => {
                    const next = e.target.value
                      .toUpperCase()
                      .replace(STORAGE_NAME_FILTER_RE, '')
                      .slice(0, MAX_STORAGE_NAME_LEN);
                    // Silently ignore keystrokes that would empty the name:
                    // an empty stem produces broken ZPL (`~DYR:,A,G,...`),
                    // and a controlled-component "refuses-to-delete-last-char"
                    // is a clearer constraint signal than a tooltip.
                    if (!next) return;
                    onChange({
                      storedAs: { device: storedAs.device, name: next },
                    });
                  }}
                />
              </div>
              <span className="text-[10px] text-muted font-mono">
                {formatStoragePath(storedAs, true)}
              </span>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={storedAs.embedInZpl !== false}
                  onChange={(e) =>
                    onChange({
                      storedAs: { ...storedAs, embedInZpl: e.target.checked },
                    })
                  }
                />
                <span className={labelCls}>{t.registry.image.embedInZpl}</span>
                <InformationCircleIcon
                  className="w-3.5 h-3.5 text-muted/60 cursor-help shrink-0"
                  title={t.registry.image.embedInZplHint}
                />
              </label>
              <button
                type="button"
                className={buttonCls}
                onClick={() => onChange({ storedAs: undefined })}
              >
                {t.registry.image.storeInline}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={buttonCls}
              onClick={() =>
                onChange({ storedAs: { device: 'R', name: defaultStorageName() } })
              }
            >
              {t.registry.image.storeOnPrinter}
            </button>
          )}
        </div>
        {pendingCacheDelete && (
          <ConfirmDialog
            message={t.registry.image.removeFromCacheConfirm}
            confirmLabel={t.registry.image.removeFromCache}
            cancelLabel={t.app.cancel}
            destructive
            onConfirm={() => {
              removeImage(p.imageId);
              onChange({ imageId: '', _gfaCache: undefined });
              setPendingCacheDelete(false);
            }}
            onCancel={() => setPendingCacheDelete(false)}
          />
        )}
      </div>
    );
  },
};
