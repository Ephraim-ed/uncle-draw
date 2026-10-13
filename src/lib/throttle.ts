/**
 * Trailing throttle that always writes the latest value: at most one call per
 * `ms`, and flush() writes immediately.
 */
export function createThrottledWriter<T>(write: (value: T) => Promise<unknown> | unknown, ms: number) {
  let latest: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    timer = null;
    if (!latest) return;
    const { value } = latest;
    latest = null;
    await write(value);
  };

  return {
    schedule(value: T) {
      latest = { value };
      if (!timer) timer = setTimeout(() => void run(), ms);
    },
    async flush() {
      if (timer) clearTimeout(timer);
      await run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      latest = null;
    },
  };
}
