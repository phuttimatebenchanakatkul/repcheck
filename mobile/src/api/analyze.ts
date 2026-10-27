/** The form-analysis routes (api/routes/analyze.py): grade a clip, list past analyses, open one, and get a link that plays its clip. */
import { parseAnalysis, parseHistory, type Analysis, type HistoryEntry } from '../logic/analyzeResult';
import { ApiError, type Api } from './client';

/** A video on the phone: what the camera or the library gives back. */
export interface PickedVideo {
  uri: string;
  name?: string;
  mimeType?: string;
}

/**
 * Trimming and grading a clip takes the server a minute or more (a model reads the video), so the default 30 s is far too short.
 * The upload itself rides on this too: a 60 s clip is tens of megabytes on a phone connection.
 */
export const ANALYZE_VIDEO_TIMEOUT_MS = 10 * 60_000;

/** The extensions the server accepts (api/analyze.py ALLOWED_EXTENSIONS and RECORDED_EXTENSIONS); it decides by the name, so the name must carry one. */
const EXTENSIONS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'] as const;
const BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
};
const MIME_OF: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm' };

function extensionOf(value: string | undefined): string | null {
  const match = /\.([a-zA-Z0-9]{1,5})(?:[?#].*)?$/.exec(value ?? '');
  const ext = match?.[1].toLowerCase();
  return ext && (EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

/** The name and type to send: the picker's own when they say what the file is, else whatever the path or type shows, else a .mp4. */
export function uploadNameAndType(video: PickedVideo): { name: string; type: string } {
  const ext = extensionOf(video.name) ?? extensionOf(video.uri) ?? BY_MIME[(video.mimeType ?? '').toLowerCase()] ?? 'mp4';
  const base = (video.name ?? '').replace(/\.[^./\\]*$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'set';
  return { name: `${base}.${ext}`, type: BY_MIME[(video.mimeType ?? '').toLowerCase()] === ext ? (video.mimeType as string).toLowerCase() : MIME_OF[ext] };
}

function videoForm(video: PickedVideo, exercise: string): FormData {
  const form = new FormData();
  const { name, type } = uploadNameAndType(video);
  // React Native's FormData takes a {uri, name, type} object for a file; the server checks the real bytes, not this label.
  form.append('video', { uri: video.uri, name, type } as unknown as Blob);
  form.append('exercise', exercise.trim());
  return form;
}

function asAnalysis(body: Record<string, unknown>): Analysis {
  const analysis = parseAnalysis(body);
  if (!analysis) throw new ApiError("Couldn't read that analysis. Please try again.", 502, body);
  return analysis;
}

export function analyzeEndpoints(api: Api) {
  return {
    /**
     * Grades a clip of a set. Throws ApiError: 403 `needsAiConsent` leads to the consent screen, 429 carries `retryAfter` (the daily
     * limit), 400 and 413 say what is wrong with the clip in words safe to show. A use is only spent when a result comes back.
     */
    async analyzeVideo(video: PickedVideo, exercise: string): Promise<Analysis> {
      return asAnalysis(await api.upload('/api/analyze', videoForm(video, exercise), ANALYZE_VIDEO_TIMEOUT_MS));
    },

    /** The person's last analyses, newest first (the server keeps 20). */
    async analysisHistory(): Promise<HistoryEntry[]> {
      return parseHistory(await api.get('/api/analyze/history'));
    },

    /** One stored analysis, with a fresh short-lived link to its clip. 404 when it is gone (an older one is pruned as new ones arrive). */
    async analysis(id: number): Promise<Analysis> {
      return asAnalysis(await api.get(`/api/analyze/history/${encodeURIComponent(String(id))}`));
    },

    /** The newest analysis, or null when there is none yet. */
    async latestAnalysis(): Promise<Analysis | null> {
      try {
        return asAnalysis(await api.get('/api/analyze/latest'));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },

    /** A new short-lived link that plays the clip of an analysis (the one in a result expires after five minutes); null when there is no clip. */
    async analysisVideoUrl(id: number): Promise<string | null> {
      try {
        const body = await api.get(`/api/analyze/video/${encodeURIComponent(String(id))}`);
        return typeof body.url === 'string' && body.url ? body.url : null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
