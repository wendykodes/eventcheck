import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const DEPTH_KEY = '__nav_depth';

/** How many in-app history entries exist (tracked by Layout). */
export function navDepth() {
  try {
    const raw = sessionStorage.getItem(DEPTH_KEY) || '[]';
    const stack = JSON.parse(raw);
    if (Array.isArray(stack)) return stack.length;
    return Number(raw || '1'); // legacy counter shape
  } catch {
    return 1;
  }
}

/**
 * History-aware back with a safe canonical fallback.
 *
 * Order: explicit `return` param (same-origin path only) → browser history
 * when the user arrived from inside the app → canonical fallback.
 *
 * `returnParam` should come from `searchParams.get('return')`.
 */
export function useHistoryBack(fallback) {
  const navigate = useNavigate();
  return useCallback((returnParam) => {
    const ret = typeof returnParam === 'string' ? returnParam : null;
    if (ret && ret.startsWith('/') && !ret.startsWith('//')) {
      navigate(ret);
      return;
    }
    if (navDepth() > 1) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, fallback]);
}

/** Build a `return` value for links into detail pages (same-origin only). */
export function currentPathWithQuery(pathname, search) {
  const s = String(search || '');
  return s ? `${pathname}?${s.startsWith('?') ? s.slice(1) : s}` : pathname;
}
