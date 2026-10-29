/** Runs jobs one at a time per key, and forgets a key once its last job has finished. */
export function createKeyedQueue() {
  const queues = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, job: () => Promise<T>): Promise<T> {
      const next = (queues.get(key) ?? Promise.resolve()).then(job, job)
      const tail = next.catch(() => undefined)
      queues.set(key, tail)
      void tail.then(() => {
        if (queues.get(key) === tail) queues.delete(key)
      })
      return next
    },
    size: (): number => queues.size
  }
}
