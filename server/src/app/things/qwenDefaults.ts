// Generation parameters for turning a photographed object into an isometric
// sprite. Static at runtime, editable here as a developer.
//
// These live in AS500 rather than in the as500-images worker for two reasons:
// changing the prompt must not require redeploying the GPU repo, and the values
// are snapshotted onto each job at enqueue time so an old Thing keeps recording
// the prompt that actually produced it. The worker has no defaults of its own —
// if AS500 did not send a value, that is a bug, not something to paper over.
//
// Seeded from server/comfyworkflows/qwen3seconds512.json (nodes 481:474 and
// 481:458), which is kept as a reference only and is never executed.

const DEFAULT_PROMPT = `chunky, simplified isometric 2.5D representation of the source object on a fully transparent background. Preserve the object's identity, proportions, structure and recognizable features. Do not reinterpret or redesign the object.

Rotate the viewpoint 45 degrees horizontally to the right around the object.
Show the object from a front-right three-quarter view.


IMPORTANT:
Transparency means an actual empty/alpha background.
Do not visually depict transparency.
Do not draw a checkerboard, grid, transparency pattern, white background,
colored background, or any other background.
`;

export interface QwenParams {
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfg: number;
  denoise: number;
  sampler: string;
  scheduler: string;
  /** Working width in pixels; the worker scales to this and keeps aspect ratio. */
  width: number;
  model: string;
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envString(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Read the current defaults. Called once per enqueue — the result is written
 * into the job row, so later edits never rewrite the history of Things that
 * were already generated.
 */
export function currentQwenParams(): QwenParams {
  return {
    prompt: envString('THINGS_QWEN_PROMPT', DEFAULT_PROMPT),
    negativePrompt: envString('THINGS_QWEN_NEGATIVE_PROMPT', ''),
    steps: envNumber('THINGS_QWEN_STEPS', 25),
    cfg: envNumber('THINGS_QWEN_CFG', 1),
    denoise: envNumber('THINGS_QWEN_DENOISE', 1),
    sampler: envString('THINGS_QWEN_SAMPLER', 'euler'),
    scheduler: envString('THINGS_QWEN_SCHEDULER', 'simple'),
    width: envNumber('THINGS_QWEN_WIDTH', 512),
    model: envString('THINGS_QWEN_MODEL', 'qwen-image-2.1'),
  };
}

/** The processor key the GPU worker advertises in its capabilities list. */
export const QWEN_PROCESSOR = 'image.qwen_i2i';
