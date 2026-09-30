// Generation parameters for describing the main object in a Thing's source
// photo. Static at runtime, editable here as a developer.
//
// Mirrors qwenDefaults.ts: these live in AS500 rather than in the
// as500-images worker so editing the prompt or schema never requires
// redeploying the GPU repo, and the values are snapshotted onto each job at
// enqueue time so an old job keeps recording the prompt that actually
// produced it. The worker has no defaults of its own — if AS500 did not send
// a value, that is a bug, not something to paper over.

const DEFAULT_PROMPT = `Look at this photo and identify the single main object in it.

Respond with ONLY a JSON object, no other text, no markdown code fences, in exactly this shape:

{
  "mainObject": {
    "name": "specific descriptive name of the object",
    "genericName": "generic name for the type of object",
    "category": "broad category, e.g. tooling, electronics, furniture, kitchenware",
    "subcategory": "narrower category or null",
    "description": "one sentence describing the object",
    "manufacturer": "manufacturer name if visible/identifiable, else null",
    "model": "model name/number if visible/identifiable, else null",
    "markings": ["any text, codes, or markings visible on the object"],
    "attributes": {
      "material": "primary material, e.g. steel, plastic, wood, or null",
      "condition": "e.g. new, used, worn, damaged, or null"
    },
    "size": {
      "longestDimensionCm": "number: your best estimate of the object's longest real-world dimension in centimetres, or null",
      "confidence": "low, medium or high"
    }
  }
}

Use null (not empty strings) for fields you cannot determine. "markings" is an array; use [] if none are visible. For "size", estimate the typical real-world size of this kind of object (or of this exact model if you recognise it), not how large it appears in the photo. Use "high" confidence only for objects with a well-known standard size; if you cannot judge, use null for longestDimensionCm. Output valid JSON only.`;

export interface DescribeParams {
  prompt: string;
  model: string;
  maxNewTokens: number;
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
 * into the job row, so later edits never rewrite the history of jobs that
 * already ran.
 */
export function currentDescribeParams(): DescribeParams {
  return {
    prompt: envString('THINGS_DESCRIBE_PROMPT', DEFAULT_PROMPT),
    model: envString('THINGS_DESCRIBE_MODEL', 'qwen3-vl-4b'),
    maxNewTokens: envNumber('THINGS_DESCRIBE_MAX_NEW_TOKENS', 512),
  };
}

/** The processor key the GPU worker advertises in its capabilities list. */
export const DESCRIBE_PROCESSOR = 'vision.qwen3vl_describe';
