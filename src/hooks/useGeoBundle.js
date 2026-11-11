import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGeoBundle } from '../lib/geoData'

// بيجيب بيانات الأقمار/التربة لنقطة (lat,lng). لو فيه farmId بيستخدم الكاش في Supabase.
// loading بيتحسب من المفاتيح (مش setState داخل effect)، وdata بترجع بس لو تخص نفس النقطة الحالية.
export function useGeoBundle(point, { farmId = null, only } = {}) {
  const lat = point?.lat ?? null
  const lng = point?.lng ?? null
  const onlyKey = only ? only.join(',') : ''
  const baseKey = `${lat}|${lng}|${farmId}|${onlyKey}`
  const [tick, setTick] = useState(0)
  const [state, setState] = useState({ baseKey: null, fullKey: null, data: null })
  const forceRef = useRef(false)
  const fullKey = `${baseKey}|${tick}`

  useEffect(() => {
    if (lat == null || lng == null) return undefined
    let cancelled = false
    const force = forceRef.current
    forceRef.current = false
    loadGeoBundle({ lat, lng }, { farmId, force, only: onlyKey ? onlyKey.split(',') : undefined })
      .then((data) => { if (!cancelled) setState({ baseKey, fullKey, data }) })
    return () => { cancelled = true }
  }, [lat, lng, farmId, onlyKey, baseKey, fullKey])

  const refresh = useCallback(() => { forceRef.current = true; setTick((t) => t + 1) }, [])
  const hasPoint = lat != null && lng != null
  return {
    hasPoint,
    loading: hasPoint && state.fullKey !== fullKey,
    data: state.baseKey === baseKey ? state.data : null,
    refresh,
  }
}
