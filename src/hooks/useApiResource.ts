import { useEffect, useState } from 'react';
import type { DataMode } from '../../shared/types';

interface CacheEntry { data: unknown; etag: string | null }
interface Resource<T> { key: string | null; data: T | null; loading: boolean; error: string | null }
const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 30;

function remember(key: string, value: CacheEntry) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** Only the exact request may reuse a result; mode, search and page are part of its key. */
export function useApiResource<T extends { mode: DataMode }>(
  url: string | null,
  mode: DataMode,
  revision: string | number = 0,
  pollInterval = 0,
) {
  const [state, setState] = useState<Resource<T>>({ key: null, data: null, loading: true, error: null });
  useEffect(() => {
    if (!url) { setState({ key: null, data: null, loading: false, error: null }); return; }
    const key = url;
    let alive = true;
    let pending = false;
    let refreshRequested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const cached = cache.get(key);
    setState(previous => ({ key,
      data: cached?.data as T ?? (previous.key === key ? previous.data : null),
      loading: !document.hidden && navigator.onLine, error: null }));

    function active() { return !document.hidden && navigator.onLine; }
    async function request() {
      if (!alive || pending || !active()) return;
      pending = true;
      controller = new AbortController();
      let timedOut = false;
      timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, 10_000);
      setState(previous => ({ ...previous, loading: true }));
      try {
        const saved = cache.get(key);
        const response = await fetch(key, {
          signal: controller.signal,
          headers: saved?.etag ? { 'If-None-Match': saved.etag } : undefined,
          cache: 'no-store',
        });
        let data: T;
        if (response.status === 304 && saved) data = saved.data as T;
        else {
          if (!response.ok) throw new Error(response.status === 404
            ? 'この機体は現在の観測に見つかりません。別のフライトを選択してください。'
            : response.status === 429 ? 'アクセスが集中しています。少し待って再取得してください。'
            : `データの取得に失敗しました (HTTP ${response.status})`);
          data = await response.json() as T;
          if (data.mode !== mode) throw new Error('データモードが一致しません。再取得してください。');
          if (alive) remember(key, { data, etag: response.headers.get('etag') });
        }
        if (alive) setState({ key, data, loading: false, error: null });
      } catch (caught) {
        if (!alive || controller.signal.aborted && !timedOut) return;
        const message = timedOut ? 'データ取得がタイムアウトしました。接続状況を確認してください。'
          : caught instanceof Error && caught.name !== 'TypeError' ? caught.message : 'サーバーに接続できません。';
        setState(previous => ({ ...previous, key, loading: false, error: message }));
      } finally {
        if (timeout) clearTimeout(timeout);
        pending = false;
        if (alive && active()) {
          if (refreshRequested) {
            refreshRequested = false;
            void request();
          } else if (pollInterval > 0) timer = setTimeout(request, pollInterval);
        }
      }
    }
    function resume() {
      if (timer) clearTimeout(timer);
      if (active()) {
        if (pending) refreshRequested = true;
        else void request();
      }
      else {
        controller?.abort();
        setState(previous => ({ ...previous, loading: false }));
      }
    }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    void request();
    return () => {
      alive = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [url, mode, revision, pollInterval]);
  return state.key === url ? state : { key: url, data: null, loading: url !== null, error: null };
}

export function useDebouncedValue<T>(value: T, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
