import { pipeline, env } from "@huggingface/transformers";
import { suggest } from "../../domain/matching.ts";
import { hasAnswerEvidence } from "../../domain/answer-evidence.ts";
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
  return {
    close: () => extractor.dispose(),
    suggest: async (messages: Message[], segments: Caption[]) => {
      const candidates = messages.filter((m) => !m.removed).slice(-200);
      if (!candidates.length || !segments.length) return [];
      const texts = [
        ...candidates.map((m) => m.text),
        ...segments.map((s) => s.text),
      ];
      const output = await extractor(texts, {
        pooling: "mean",
        normalize: true,
      });
      const vectors = output.data;
      const width = output.dims[1];
      if (!width) throw new Error("Invalid embedding shape");
      const results: {
        messageId: string;
        start: number;
        end: number;
        evidence: string;
      }[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment || !hasAnswerEvidence(segment.text)) continue;
        const named = suggest(candidates, [segment]);
        if (named.length === 1 && named[0]) {
          results.push(named[0]);
          continue;
        }
        const scores = candidates
          .map((m, j) => {
            let score = 0;
            for (let k = 0; k < width; k++)
              score +=
                Number(vectors[j * width + k]) *
                Number(vectors[(candidates.length + i) * width + k]);
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
