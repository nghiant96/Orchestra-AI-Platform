let extractor: ((text: string, options?: Record<string, unknown>) => Promise<{ data: ArrayLike<unknown> }>) | null = null;
let extractorPromise: Promise<((text: string, options?: Record<string, unknown>) => Promise<{ data: ArrayLike<unknown> }>) | null> | null =
  null;

async function getExtractor() {
  if (extractor) {
    return extractor;
  }
  if (extractorPromise) {
    return extractorPromise;
  }

  extractorPromise = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      return extractor;
    } catch {
      return null;
    } finally {
      extractorPromise = null;
    }
  })();

  return extractorPromise;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || typeof text !== "string") {
    return null;
  }

  const model = await getExtractor();
  if (!model) {
    return null;
  }

  try {
    const output = await model(text, { pooling: "mean", normalize: true });
    return Array.from(output.data, (value) => Number(value));
  } catch {
    return null;
  }
}

export function cosineSimilarity(vecA: number[] | null | undefined, vecB: number[] | null | undefined): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < vecA.length; index += 1) {
    dotProduct += vecA[index] * vecB[index];
    normA += vecA[index] * vecA[index];
    normB += vecB[index] * vecB[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
