#!/usr/bin/env node
/**
 * Offline Meshy pipeline. Never imported by the Next app.
 * Docs checked 2026-10-22:
 *   POST https://api.meshy.ai/openapi/v1/image-to-3d
 *   POST https://api.meshy.ai/openapi/v2/text-to-3d   (mode preview, then refine)
 *   POST https://api.meshy.ai/openapi/v1/rigging
 *   POST https://api.meshy.ai/openapi/v1/animations
 * Documented example consumed_credits: image-to-3d 30, text-to-3d task object 20,
 * rigging 5, one animation 3. Actual cost is the task's consumed_credits.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, 'public/models');
const yes = process.argv.includes('--yes');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'all';

function loadKey() {
  const path = resolve(root, '.env.local');
  if (!existsSync(path)) return '';
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((row) => row.startsWith('MESHY_API_KEY='));
  return line ? line.slice('MESHY_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : '';
}

const PLAN = [
  { id: 'image', label: 'Image-to-3D from monshi-mascot.png (meshy-7.1, textured GLB)', credits: 30 },
  { id: 'logo', label: 'Text-to-3D preview "MON PAD" logotype', credits: 20 },
  { id: 'refine', label: 'Text-to-3D refine of that preview', credits: 20 },
  { id: 'rig', label: 'Rig the character (humanoid only; walk/run come with it)', credits: 5 },
  { id: 'anim', label: 'One animation task (action_id library). Wave/celebrate need library ids.', credits: 3 },
];

const selected = only === 'all' ? PLAN : PLAN.filter((step) => step.id === only);
const estimate = selected.reduce((sum, step) => sum + step.credits, 0);

console.log('Meshy plan (documented example credits, not a quote):');
for (const step of selected) console.log(`  ${step.credits}  ${step.label}`);
console.log(`Estimated example total: ${estimate} credits`);
console.log('The app does not need this. Home uses a procedural scene and /meshy/monshi-mascot.png.');

if (!yes) {
  console.log('Refusing to spend credits. Re-run with --yes after you confirm.');
  process.exit(0);
}

const key = loadKey();
if (!key) {
  console.error('MESHY_API_KEY missing from .env.local');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`https://api.meshy.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function poll(path) {
  let wait = 2000;
  for (let i = 0; i < 80; i++) {
    const task = await api('GET', path);
    const credits = task.consumed_credits ?? '?';
    console.log(`${path} ${task.status} ${task.progress ?? ''}% credits=${credits}`);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(task.task_error?.message || task.status);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.4, 15000);
  }
  throw new Error(`timed out ${path}`);
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, file), buf);
  console.log(`wrote public/models/${file} (${buf.length} bytes)`);
}

if (selected.some((s) => s.id === 'image')) {
  const png = readFileSync(resolve(root, 'public/meshy/monshi-mascot.png'));
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  const created = await api('POST', '/openapi/v1/image-to-3d', {
    image_url: dataUri,
    ai_model: 'meshy-7.1',
    should_texture: true,
    enable_pbr: true,
    target_formats: ['glb'],
    pose_mode: 'a-pose',
  });
  const task = await poll(`/openapi/v1/image-to-3d/${created.result}`);
  const url = task.model_urls?.glb || task.model_urls?.GLB;
  if (!url) throw new Error('image-to-3d returned no glb url');
  await download(url, 'monshi.glb');
}

if (selected.some((s) => s.id === 'logo' || s.id === 'refine')) {
  const preview = await api('POST', '/openapi/v2/text-to-3d', {
    mode: 'preview',
    prompt: 'Chunky 3D logotype reading MON PAD, glossy purple metal, no extra objects, front view',
    ai_model: 'meshy-7.1',
    target_formats: ['glb'],
  });
  const previewTask = await poll(`/openapi/v2/text-to-3d/${preview.result}`);
  if (selected.some((s) => s.id === 'refine' || s.id === 'logo')) {
    const refine = await api('POST', '/openapi/v2/text-to-3d', {
      mode: 'refine',
      preview_task_id: previewTask.id,
      ai_model: 'meshy-7.1',
    });
    const refined = await poll(`/openapi/v2/text-to-3d/${refine.result}`);
    const url = refined.model_urls?.glb;
    if (url) await download(url, 'mon-pad-logo.glb');
  }
}

console.log('Done. Optimize with gltf-transform if the GLB is over 2MB, then git add -f public/models.');
