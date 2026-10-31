import { pipeline, env } from "@huggingface/transformers";
import { suggest } from "../../domain/matching.ts";
import { hasAnswerEvidence } from "../../domain/answer-evidence.ts";
import { EmbeddingCache } from "./embedding-cache.ts";
import type {
  Caption,
  Message,
} from "../../../../../shared/contracts/models.ts";
export async function createSemanticMatcher(modelPath: string) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const extractor = await pipeline("feature-extraction", modelPath, {
    dtype: "q8",
    device: "cpu",
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  const cache = new EmbeddingCache(async (texts) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const width = output.dims[1];
    if (!width) throw new Error("Invalid embedding shape");
    return texts.map((_, i) =>
      Float32Array.from(output.data.slice(i * width, (i + 1) * width), Number),
    );
  });
  return {
    clearCache: () => cache.clear(),
    close: () => {
      cache.clear();
      return extractor.dispose();
    },
    suggest: async (messages: Message[], segments: Caption[]) => {
      const candidates = messages.filter((m) => !m.removed).slice(-200);
      if (!candidates.length || !segments.length) return [];
      const texts = [
        ...candidates.map((m) => m.text),
        ...segments.map((s) => s.text),
      ];
      const vectors = await cache.vectors(texts);
      const results: {
        messageId: string;
        start: number;
        end: number;
        evidence: string;
        method: "name-topic" | "meaning";
      }[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment || !hasAnswerEvidence(segment.text)) continue;
        const named = suggest(candidates, [segment]);
        if (named.length === 1 && named[0]) {
          results.push({ ...named[0], method: "name-topic" });
          continue;
        }
        const scores = candidates
          .map((m, j) => {
            let score = 0;
            const message = vectors[j],
              response = vectors[candidates.length + i];
            if (!message || !response || message.length !== response.length)
              throw new Error("Invalid embedding shape");
            for (let k = 0; k < message.length; k++)
              score += Number(message[k]) * Number(response[k]);
            return { m, score };
          })
          .sort((a, b) => b.score - a.score);
        const best = scores[0],
          second = scores[1],
          s = segments[i];
        if (
          best &&
          s &&
          best.score >= 0.7 &&
          (!second || best.score - second.score >= 0.12)
        )
          results.push({
            messageId: best.m.id,
            start: s.start,
            end: s.end,
            evidence: s.text,
            method: "meaning",
          });
      }
      return results;
    },
  };
}
export async function semanticSuggestions(
  messages: Message[],
  segments: Caption[],
  modelPath: string,
) {
  const matcher = await createSemanticMatcher(modelPath);
  try {
    return await matcher.suggest(messages, segments);
  } finally {
    await matcher.close();
  }
}
