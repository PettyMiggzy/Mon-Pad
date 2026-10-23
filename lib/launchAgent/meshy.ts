// lib/launchAgent/meshy.ts — SERVER-ONLY Meshy client. The key comes from the
// environment (MESHY_API_KEY) and is never sent to the browser or logged.
// Endpoints per docs.meshy.ai: image-to-3d, rigging (takes input_task_id).

const BASE = 'https://api.meshy.ai/openapi/v1';

export const meshyKey = (): string | null => {
  const k = (process.env.MESHY_API_KEY || '').trim();
  return k.length > 10 ? k : null;
};
export const meshyConfigured = () => !!meshyKey();

async function call(path: string, init?: RequestInit) {
  const key = meshyKey();
  if (!key) throw new Error('3D generation is not configured');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(d?.message || d?.error || `3D service error ${res.status}`).slice(0, 160));
  return d;
}

/** Start image -> textured 3D model. Image must be a public URL or data URI. */
export async function startImageTo3D(imageUrl: string): Promise<string> {
  const d = await call('/image-to-3d', {
    method: 'POST',
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: 'meshy-7.1',
      should_texture: true,
      enable_pbr: false,
      should_remesh: true,
      target_polycount: 30000,
      pose_mode: 'a-pose',
      target_formats: ['glb'],
    }),
  });
  if (!d?.result) throw new Error('no task id from 3D service');
  return String(d.result);
}

export type MeshyTask = { status: string; progress: number; error?: string; glb?: string };

export async function getImageTo3D(id: string): Promise<MeshyTask> {
  const d = await call(`/image-to-3d/${encodeURIComponent(id)}`);
  return { status: d.status, progress: d.progress ?? 0, error: d?.task_error?.message || undefined, glb: d?.model_urls?.glb };
}

/** Rig a finished image-to-3d task (humanoid only; may fail for odd shapes). */
export async function startRigging(imageTaskId: string, heightMeters = 1.0): Promise<string> {
  const d = await call('/rigging', { method: 'POST', body: JSON.stringify({ input_task_id: imageTaskId, height_meters: heightMeters }) });
  if (!d?.result) throw new Error('no rigging task id');
  return String(d.result);
}

export async function getRigging(id: string): Promise<MeshyTask> {
  const d = await call(`/rigging/${encodeURIComponent(id)}`);
  return { status: d.status, progress: d.progress ?? 0, error: d?.task_error?.message || undefined, glb: d?.result?.rigged_character_glb_url };
}

/** Meshy asset URLs expire, so we copy the GLB into our own storage when a job finishes. */
export async function downloadGlb(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB file');
  return buf;
}
