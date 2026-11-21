/** Observers cannot fail an operation, whether they throw or reject asynchronously. */
export function notifyObserver<T>(
  observer: ((event: T) => void | Promise<void>) | undefined,
  event: T,
): void {
  if (!observer) return;
  try {
    void Promise.resolve(observer(event)).catch(() => {});
  } catch {
    // Operational success does not depend on observability.
  }
}
