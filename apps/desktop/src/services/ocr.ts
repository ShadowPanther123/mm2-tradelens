import type { Worker } from "tesseract.js";
import type { OcrWord } from "./ocrMatch";
import { fitWithin, validateImageFile } from "./ocrInput";

/**
 * In-app OCR for reading item names off a trade-window screenshot the user
 * provides. TradeLens never captures or reads the Roblox client itself — the
 * user chooses and supplies the image. All assets are bundled locally so this
 * works fully offline.
 *
 * Tesseract is heavy, so it is imported dynamically the first time OCR actually
 * runs (never at app startup), can be cancelled mid-run, and its worker is
 * released after a short idle period to free memory. Lightweight builds can
 * drop the feature entirely with `VITE_OCR_DISABLED`.
 */

/** Whether OCR is included in this build. Lightweight builds set it off. */
export const OCR_ENABLED =
  import.meta.env.VITE_OCR_DISABLED !== "true" &&
  import.meta.env.VITE_OCR_DISABLED !== "1";

export type OcrPhase = "loading" | "recognizing" | "done";

export interface OcrProgress {
  phase: OcrPhase;
  /** 0–1 within the current phase. */
  progress: number;
  /** Friendly, human-readable status. */
  label: string;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

export interface RecognizeOptions {
  onProgress?: (progress: OcrProgress) => void;
  /** Abort the run; the worker is torn down and the promise rejects. */
  signal?: AbortSignal;
}

/** Thrown when a recognition run is cancelled by the caller. */
export class OcrCancelledError extends Error {
  constructor() {
    super("OCR was cancelled.");
    this.name = "OcrCancelledError";
  }
}

let workerPromise: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Release the idle worker this long after the last recognition finishes. */
const IDLE_RELEASE_MS = 30_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OcrCancelledError();
}

/** Map Tesseract's raw status strings onto clearer, phased progress semantics. */
function toProgress(status: string, progress: number): OcrProgress {
  const s = status.toLowerCase();
  if (s.includes("recognizing")) {
    return { phase: "recognizing", progress, label: "Reading item names…" };
  }
  return { phase: "loading", progress, label: "Preparing text engine…" };
}

function cancelIdleRelease(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** Schedule the worker to be torn down once OCR has been idle for a while. */
function scheduleIdleRelease(): void {
  cancelIdleRelease();
  idleTimer = setTimeout(() => {
    void disposeOcr();
  }, IDLE_RELEASE_MS);
}

async function getWorker(
  onProgress?: (progress: OcrProgress) => void,
): Promise<Worker> {
  cancelIdleRelease();
  if (!workerPromise) {
    // Dynamic import keeps Tesseract (and its wasm/worker assets) out of the
    // startup bundle — it only loads the first time OCR is actually used.
    workerPromise = import("tesseract.js").then(({ createWorker, PSM }) =>
      createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/",
        langPath: "/tessdata",
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          onProgress?.(toProgress(m.status, m.progress));
        },
      }).then(async (worker) => {
        // Tuning for short UI labels: keep inter-word spacing, and treat the
        // image as a sparse set of text lines rather than one paragraph.
        await worker.setParameters({
          preserve_interword_spaces: "1",
          // Sparse text: find as much text as possible in no particular order,
          // which suits scattered item labels in a trade window.
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        });
        return worker;
      }),
    );
  }
  return workerPromise;
}

/**
 * Preprocess an image to improve OCR accuracy on small, anti-aliased UI text:
 * upscale small images, convert to greyscale, and stretch contrast so faint
 * labels stand out. Runs entirely on the user's device via a canvas.
 */
async function preprocess(
  image: string | File | HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const source = await toBitmapSource(image);

  // Cap enormous screenshots first (memory + speed), then upscale small ones so
  // the smaller dimension clears the ~20px cap-height Tesseract needs.
  const capped = fitWithin(source.width, source.height);
  const MIN_DIMENSION = 1000;
  const scale = Math.min(
    3,
    Math.max(1, MIN_DIMENSION / Math.min(capped.width, capped.height)),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(capped.width * scale));
  canvas.height = Math.max(1, Math.round(capped.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;

  // First pass: greyscale + find the luminance range for contrast stretching.
  let min = 255;
  let max = 0;
  const grey = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    const lum = Math.round(
      0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!,
    );
    grey[g] = lum;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  // Second pass: stretch contrast across the observed range.
  const range = Math.max(1, max - min);
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    const stretched = ((grey[g]! - min) / range) * 255;
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Load any supported image source into something drawable on a canvas. */
async function toBitmapSource(
  image: string | File | HTMLCanvasElement,
): Promise<{ width: number; height: number } & CanvasImageSource> {
  if (image instanceof HTMLCanvasElement) return image;

  const url = image instanceof File ? URL.createObjectURL(image) : image;
  try {
    const el = new Image();
    el.decoding = "async";
    el.src = url;
    try {
      await el.decode();
    } catch {
      // decode() rejects on unsupported/corrupt data — surface a clear error.
      throw new Error("That image couldn't be read. Try a PNG or JPEG.");
    }
    // width/height come from naturalWidth/Height on HTMLImageElement.
    return Object.assign(el, {
      width: el.naturalWidth,
      height: el.naturalHeight,
    });
  } finally {
    if (image instanceof File) URL.revokeObjectURL(url);
  }
}

/** Run OCR over an image source (data URL, blob URL, File or canvas). */
export async function recognizeImage(
  image: string | File | HTMLCanvasElement,
  options: RecognizeOptions = {},
): Promise<OcrResult> {
  if (!OCR_ENABLED) {
    throw new Error("OCR is not available in this build.");
  }
  const { onProgress, signal } = options;
  throwIfAborted(signal);

  if (image instanceof File) {
    const check = validateImageFile({
      type: image.type,
      size: image.size,
      name: image.name,
    });
    if (!check.ok) throw new Error(check.reason);
  }

  const worker = await getWorker(onProgress);
  throwIfAborted(signal);

  // Cancellation: aborting tears down the worker, which rejects the in-flight
  // recognize call, and we surface a dedicated cancelled error.
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => {
      void disposeOcr();
      reject(new OcrCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    let input: string | File | HTMLCanvasElement = image;
    try {
      input = await preprocess(image);
    } catch (err) {
      // A genuine decode failure should stop; other preprocessing hiccups fall
      // back to the raw image.
      if (err instanceof Error && err.message.includes("couldn't be read")) {
        throw err;
      }
      input = image;
    }
    throwIfAborted(signal);

    const { data } = await Promise.race([worker.recognize(input), abortPromise]);
    const words: OcrWord[] = (data.words ?? []).map((w) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox
        ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }
        : undefined,
    }));
    onProgress?.({ phase: "done", progress: 1, label: "Done" });
    return { text: data.text, words };
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    scheduleIdleRelease();
  }
}

/** Release the worker and its memory (on cancel, idle, or leaving the screen). */
export async function disposeOcr(): Promise<void> {
  cancelIdleRelease();
  if (workerPromise) {
    const pending = workerPromise;
    workerPromise = null;
    try {
      const worker = await pending;
      await worker.terminate();
    } catch {
      // Worker may already be gone; nothing more to release.
    }
  }
}
