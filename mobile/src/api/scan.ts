/** The food-scan routes: an AI photo, a barcode (photo or digits), and the online food search. Shapes are api/routes/foods.py's. */
import { parseScanResult, type ScanResult } from '../logic/scan';
import { ApiError, type Api } from './client';

/** A photo on the phone: what the camera or the library gives back. */
export interface PickedImage {
  uri: string;
  name?: string;
  mimeType?: string;
}

/** A barcode lookup has three honest outcomes besides an error: found, no such product, or the lookup itself failed. */
export type BarcodeOutcome =
  | { kind: 'found'; result: ScanResult }
  | { kind: 'not-found'; barcode: string; message: string }
  | { kind: 'failed'; barcode: string | null; message: string };

/** Grading a photo is the slow call in this file; the default 30 s is too short for a busy model. */
export const ANALYZE_TIMEOUT_MS = 90_000;

function imageForm(image: PickedImage, fields: Record<string, string | undefined> = {}): FormData {
  const form = new FormData();
  // React Native's FormData takes a {uri, name, type} object for a file; the server checks the real bytes, not this label.
  form.append('image', { uri: image.uri, name: image.name ?? 'photo.jpg', type: image.mimeType ?? 'image/jpeg' } as unknown as Blob);
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== '') form.append(key, value);
  return form;
}

function asResult(body: Record<string, unknown>): ScanResult {
  const result = parseScanResult(body);
  if (!result) throw new ApiError("Couldn't read that result. Please try again.", 502, body);
  return result;
}

function bodyOf(error: ApiError): Record<string, unknown> {
  return (error.body ?? {}) as Record<string, unknown>;
}

function barcodeOutcome(error: unknown): BarcodeOutcome {
  if (!(error instanceof ApiError)) throw error;
  const body = bodyOf(error);
  const barcode = typeof body.barcode === 'string' && body.barcode ? body.barcode : null;
  if (body.not_found === true && barcode) return { kind: 'not-found', barcode, message: error.message };
  // The server read the barcode but the product database behind it failed (502), or no barcode could be read in the photo (502).
  if (error.status === 502) return { kind: 'failed', barcode, message: error.message };
  throw error;
}

export function scanEndpoints(api: Api) {
  return {
    /** An AI estimate from a photo of a meal. Throws ApiError: 403 `needsAiConsent` leads to the consent screen, 429 carries `retryAfter`. */
    async analyzeFood(image: PickedImage, note?: string): Promise<ScanResult> {
      return asResult(await api.upload('/api/analyze-food', imageForm(image, { note: note?.trim() }), ANALYZE_TIMEOUT_MS));
    },

    /** Reads a barcode out of a photo (or a live camera frame: `live` keeps routine misses out of the server's logs) and looks it up. */
    async scanBarcodePhoto(image: PickedImage, live = false): Promise<BarcodeOutcome> {
      try {
        return { kind: 'found', result: asResult(await api.upload('/api/scan-barcode', imageForm(image, { live: live ? '1' : undefined }))) };
      } catch (error) {
        return barcodeOutcome(error);
      }
    },

    /** Looks up digits the phone's own scanner already read. */
    async lookupBarcode(barcode: string): Promise<BarcodeOutcome> {
      try {
        return { kind: 'found', result: asResult(await api.post('/api/lookup-barcode', { barcode })) };
      } catch (error) {
        return barcodeOutcome(error);
      }
    },

    /** Products by name from the open food database; results that cannot be read are skipped, not fatal. */
    async searchFoodsOnline(query: string): Promise<ScanResult[]> {
      const body = await api.get('/api/search-food-online', { q: query.trim() });
      const results = Array.isArray(body.results) ? body.results : [];
      return results.flatMap((raw): ScanResult[] => {
        const result = parseScanResult(raw);
        return result ? [result] : [];
      });
    },
  };
}
