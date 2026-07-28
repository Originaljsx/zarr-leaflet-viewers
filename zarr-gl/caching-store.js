/**
 * A caching, request-deduplicating wrapper around a zarrita store.
 *
 * Tiles are much smaller than chunks, so many tiles resolve to the same bytes:
 * a 256 px tile at z9 spans ~37 cells of the MUR 1 km grid, while one inner
 * chunk of its sharded store holds 450x450. Without a cache here, a single
 * viewport re-requests and re-decodes the same byte range once per tile -- 19
 * times for the same `bytes=0-130296` in the worst case measured, 10.4 MB
 * transferred to obtain 1.1 MB of distinct data.
 *
 * Both `get` and `getRange` are cached, keyed by key and byte range, and
 * concurrent callers share one in-flight request.
 *
 * Requests deliberately run without the caller's `AbortSignal`. A shared
 * request must not be cancellable by whichever caller happens to lose interest
 * first, and bytes already in flight are worth keeping: the tile that leaves
 * the viewport mid-pan is usually adjacent to one entering it. Callers still
 * see their own abort -- `signal` rejects the promise they hold, it just no
 * longer discards the download.
 */

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** Reject as soon as `signal` aborts, without disturbing `promise` itself. */
function raceAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function rangeKey(range) {
  if (!range) return ''
  if ('suffixLength' in range) return `|suffix:${range.suffixLength}`
  return `|${range.offset}:${range.length}`
}

export class CachingStore {
  /** @param {{ get: Function, getRange?: Function }} store */
  constructor(store, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.store = store
    this.maxBytes = maxBytes
    this.bytes = 0
    /** @type {Map<string, { promise: Promise<Uint8Array|undefined>, bytes: number }>} */
    this.entries = new Map()
    this.stats = { hits: 0, misses: 0 }
  }

  get url() {
    return this.store.url
  }

  async get(key, opts = {}) {
    const { signal, ...rest } = opts
    return raceAbort(this._entry(key, () => this.store.get(key, rest)), signal)
  }

  async getRange(key, range, opts = {}) {
    const { signal, ...rest } = opts
    return raceAbort(
      this._entry(key + rangeKey(range), () => this.store.getRange(key, range, rest)),
      signal,
    )
  }

  _entry(cacheKey, load) {
    const existing = this.entries.get(cacheKey)
    if (existing) {
      this.stats.hits += 1
      // Re-insert to mark as recently used.
      this.entries.delete(cacheKey)
      this.entries.set(cacheKey, existing)
      return existing.promise
    }
    this.stats.misses += 1
    const entry = { bytes: 0, promise: null }
    entry.promise = load().then(
      (value) => {
        entry.bytes = value?.byteLength ?? 0
        this.bytes += entry.bytes
        this._trim()
        return value
      },
      (error) => {
        this.entries.delete(cacheKey)
        throw error
      },
    )
    this.entries.set(cacheKey, entry)
    return entry.promise
  }

  _trim() {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.entries.delete(key)
      this.bytes -= entry.bytes
    }
  }

  clear() {
    this.entries.clear()
    this.bytes = 0
  }
}
