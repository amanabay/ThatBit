// Model-scoped, bounded in-memory cache. Disposal drops all source text/vectors.
export class EmbeddingCache {
  private entries = new Map<string, Float32Array>();
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private embed: (texts: string[]) => Promise<Float32Array[]>,
    private capacity = 1000,
  ) {}
  clear() {
    this.entries.clear();
  }
  async vectors(texts: string[]) {
    // Serialize cache fills and native inference; overlapping consumers reuse results.
    const previous = this.queue;
    let release: () => void = () => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const result = new Map<string, Float32Array>();
      const missing = [...new Set(texts)].filter((text) => {
        const cached = this.entries.get(text);
        if (!cached) return true;
        result.set(text, cached);
        this.entries.delete(text);
        this.entries.set(text, cached);
        return false;
      });
      for (let offset = 0; offset < missing.length; offset += 64) {
        const batch = missing.slice(offset, offset + 64);
        const vectors = await this.embed(batch);
        if (
          vectors.length !== batch.length ||
          vectors.some((v) => !v.length || !v.every(Number.isFinite))
        )
          throw new Error("Invalid embedding output");
        batch.forEach((text, i) => {
          const vector = vectors[i];
          if (!vector) throw new Error("Missing embedding");
          result.set(text, vector);
          this.entries.set(text, vector);
          while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
          }
        });
      }
      return texts.map((text) => {
        const vector = result.get(text);
        if (!vector) throw new Error("Missing embedding");
        return vector;
      });
    } finally {
      release();
    }
  }
}
