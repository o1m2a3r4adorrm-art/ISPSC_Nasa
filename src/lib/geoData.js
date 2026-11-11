// src/lib/geoData.js
// طبقة بيانات الأقمار والتربة: كل مصدر له وظيفة واضحة، وأي مصدر يفشل بيرجّع { ok:false, error } — مفيش أبدًا رقم بديل أو افتراضي.
// المصادر المفعّلة هنا (بدون مفاتيح): NASA POWER، ISRIC SoilGrids، NASA SRTM (عبر OpenTopoData)، MODIS NDVI (ORNL DAAC).
// المصادر اللي محتاجة حساب Earthdata ومعالجة على السيرفر موضحة في PENDING_SOURCES ومش بتعرض أي قيمة.
import { supabase } from './supabase'
import { NASA_POWER_DAILY_API_BASE } from '../data/weatherConfig'
import { nasaValid, toYmd } from './nasaPower'

const DAY = 86400000
const TIMEOUT_MS = 25000
const round = (v, d = 1) => { const f = 10 ** d; return Math.round(v * f) / f }

/* ───────── شبكة: مباشر من المتصفح، ولو اتمنع (CORS / 5xx / مهلة) نجرّب الوسيط geo-proxy لو منشور ───────── */
async function viaProxy(url) {
  const { data, error } = await supabase.functions.invoke('geo-proxy', { body: { url } })
  if (error) throw error
  return data
}

export async function fetchJson(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e }
    return await res.json()
  } catch (err) {
    const retryable = err?.name === 'TypeError' || err?.name === 'AbortError' || err?.status >= 500
    if (!retryable) throw err
    try { return await viaProxy(url) } catch { throw err }
  } finally {
    clearTimeout(timer)
  }
}

const failure = (label, err) => ({
  ok: false,
  error: `${label}: ${err?.status ? `الخدمة رجّعت خطأ (${err.status})` : err?.message === 'EMPTY' ? 'مفيش بيانات متاحة للموقع ده' : 'تعذّر الاتصال بالخدمة'}`,
})
const EMPTY = () => new Error('EMPTY')

/* ───────── NASA POWER: مناخ زراعي + مياه (آخر 30 يوم فعلي) ───────── */
// الإشعاع الخارجي الأرضي Ra (FAO-56 معادلة 21) بالمم/يوم — بيدخل في حساب ET0
function extraterrestrialMm(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365)
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39)
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  return ra * 0.408
}
const dayOfYear = (ymd) => Math.floor((Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) - Date.UTC(+ymd.slice(0, 4), 0, 0)) / DAY)

export async function getPowerAgro(lat, lng) {
  try {
    const end = new Date()
    const start = new Date(end.getTime() - 45 * DAY)
    const params = new URLSearchParams({
      parameters: 'T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,GWETTOP,GWETROOT',
      community: 'AG', latitude: lat, longitude: lng, start: toYmd(start), end: toYmd(end), format: 'JSON',
    })
    const json = await fetchJson(`${NASA_POWER_DAILY_API_BASE}?${params}`)
    const p = json?.properties?.parameter
    if (!p?.T2M_MAX) throw new Error('bad')

    const keys = Object.keys(p.T2M_MAX).sort().filter((k) => nasaValid(p.T2M_MAX[k]) && nasaValid(p.T2M_MIN?.[k]))
    const use = keys.slice(-30)
    if (use.length < 10) throw EMPTY()

    const rainDays = use.filter((k) => nasaValid(p.PRECTOTCORR?.[k]))
    const rainOk = rainDays.length >= use.length * 0.8
    const sumRain = (list) => round(list.reduce((s, k) => s + (nasaValid(p.PRECTOTCORR?.[k]) ? p.PRECTOTCORR[k] : 0), 0), 1)
    const et0 = use.reduce((s, k) => {
      const tmax = p.T2M_MAX[k]; const tmin = p.T2M_MIN[k]
      const tmean = (tmax + tmin) / 2
      return s + Math.max(0, 0.0023 * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * extraterrestrialMm(lat, dayOfYear(k)))
    }, 0)
    const avgLast = (name, n = 7) => {
      const vals = keys.slice(-n).map((k) => p[name]?.[k]).filter(nasaValid)
      return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null
    }
    const solar = use.map((k) => p.ALLSKY_SFC_SW_DWN?.[k]).filter(nasaValid)
    const last = use[use.length - 1]

    return {
      ok: true, source: 'NASA POWER (MERRA-2)', resolution: '≈ 50 كم',
      asOf: `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}`,
      daysUsed: use.length,
      rain30Mm: rainOk ? sumRain(use) : null,
      rain7Mm: rainOk ? sumRain(use.slice(-7)) : null,
      et0Mm30: round(et0, 1),
      balanceMm30: rainOk ? round(sumRain(use) - et0, 1) : null,
      wetnessTop: avgLast('GWETTOP'),
      wetnessRoot: avgLast('GWETROOT'),
      tmaxC: round(use.reduce((s, k) => s + p.T2M_MAX[k], 0) / use.length, 1),
      tminC: round(use.reduce((s, k) => s + p.T2M_MIN[k], 0) / use.length, 1),
      solarMj: solar.length ? round(solar.reduce((a, b) => a + b, 0) / solar.length, 1) : null,
    }
  } catch (err) {
    return failure('NASA POWER', err)
  }
}

/* ───────── ISRIC SoilGrids: خصائص التربة (متوسط 0–30 سم) ───────── */
export async function getSoilGrids(lat, lng) {
  try {
    const qs = new URLSearchParams()
    qs.set('lon', lng); qs.set('lat', lat)
    ;['phh2o', 'clay', 'sand', 'silt', 'soc', 'cec', 'bdod'].forEach((x) => qs.append('property', x))
    ;['0-5cm', '5-15cm', '15-30cm'].forEach((x) => qs.append('depth', x))
    qs.append('value', 'mean')
    const json = await fetchJson(`https://rest.isric.org/soilgrids/v2.0/properties/query?${qs}`)
    const layers = json?.properties?.layers
    if (!Array.isArray(layers)) throw new Error('bad')

    const WEIGHT = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15 } // وزن كل طبقة = سُمكها بالسم
    const values = {}
    for (const layer of layers) {
      const factor = layer?.unit_measure?.d_factor || 1 // التحويل من الوحدة المخزنة لوحدة القياس الحقيقية (من رد الخدمة نفسه)
      let sum = 0; let w = 0
      for (const d of layer.depths || []) {
        const m = d?.values?.mean
        if (typeof m === 'number' && WEIGHT[d.label]) { sum += (m / factor) * WEIGHT[d.label]; w += WEIGHT[d.label] }
      }
      if (w > 0) values[layer.name] = { value: round(sum / w, layer.name === 'bdod' ? 2 : 1), unit: layer.unit_measure?.target_units || '' }
    }
    if (Object.keys(values).length === 0) throw EMPTY()
    return { ok: true, source: 'ISRIC SoilGrids 2.0', resolution: '250 م', depth: '0–30 سم', modeled: true, values }
  } catch (err) {
    return failure('SoilGrids', err)
  }
}

/* ───────── SRTM: الارتفاع والانحدار ───────── */
export async function getTerrain(lat, lng) {
  try {
    const d = 0.003 // ≈ 330 م — نافذة واسعة عشان ضوضاء SRTM على الأراضي المسطّحة ما تطلعش انحدار وهمي
    const pts = [[lat, lng], [lat + d, lng], [lat - d, lng], [lat, lng + d], [lat, lng - d]]
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${pts.map((q) => q.map((x) => x.toFixed(6)).join(',')).join('|')}`
    const json = await fetchJson(url)
    const z = (json?.results || []).map((r) => r?.elevation)
    if (z.length !== 5 || z.some((v) => typeof v !== 'number')) throw EMPTY()
    const dy = 110540 * d * 2
    const dx = 111320 * Math.cos((lat * Math.PI) / 180) * d * 2
    const slopePct = round(Math.sqrt(((z[3] - z[4]) / dx) ** 2 + ((z[1] - z[2]) / dy) ** 2) * 100, 1)
    return { ok: true, source: 'NASA SRTM 30 م (عبر OpenTopoData)', resolution: '30 م', elevationM: Math.round(z[0]), slopePct, flat: slopePct < 2, windowM: 660 }
  } catch (err) {
    return failure('SRTM', err)
  }
}

/* ───────── MODIS MOD13Q1: NDVI كل 16 يوم (250 م) عبر ORNL DAAC ───────── */
const ORNL = 'https://modis.ornl.gov/rst/api/v1/MOD13Q1'
export async function getModisNdvi(lat, lng) {
  try {
    const dj = await fetchJson(`${ORNL}/dates?latitude=${lat}&longitude=${lng}`)
    const dates = (dj?.dates || []).slice(-10)
    if (dates.length === 0) throw EMPTY()
    const qs = new URLSearchParams({
      latitude: lat, longitude: lng, band: '250m_16_days_NDVI',
      startDate: dates[0].modis_date, endDate: dates[dates.length - 1].modis_date, kmAboveBelow: 0, kmLeftRight: 0,
    })
    const sj = await fetchJson(`${ORNL}/subset?${qs}`)
    const scale = Number(sj?.header?.scale) || 0.0001
    const series = (sj?.subset || [])
      .map((r) => ({ date: r.calendar_date, raw: r.data?.[0] }))
      .filter((r) => typeof r.raw === 'number' && r.raw >= -2000 && r.raw <= 10000) // -3000 = قيمة غير متاحة
      .map((r) => ({ date: r.date, ndvi: round(r.raw * scale, 2) }))
    if (series.length === 0) throw EMPTY()
    return { ok: true, source: 'NASA MODIS MOD13Q1 (عبر ORNL DAAC)', resolution: '250 م', series, latest: series[series.length - 1] }
  } catch (err) {
    return failure('MODIS NDVI', err)
  }
}

/* ───────── المصادر اللي لسه مش مفعّلة (محتاجة حساب Earthdata ومعالجة على السيرفر) ───────── */
export const PENDING_SOURCES = [
  { id: 'smap', name: 'NASA SMAP', purpose: 'رطوبة التربة السطحية', reason: 'محتاج تسجيل دخول Earthdata وطلب من السيرفر. دقته المكانية 9–36 كم، فهو مؤشر إقليمي مش قياس للأرض.' },
  { id: 'ecostress', name: 'NASA ECOSTRESS', purpose: 'حرارة سطح الأرض والإجهاد الحراري', reason: 'محتاج Earthdata ومعالجة على السيرفر، وبيغطي مناطق وأوقات متفرقة مش يومي.' },
  { id: 'gpm', name: 'NASA GPM IMERG', purpose: 'الأمطار (قيمة رقمية)', reason: 'متاح كطبقة صورة في "الخريطة الزراعية". القيمة الرقمية محتاجة Earthdata. الأمطار الظاهرة هنا جاية من NASA POWER.' },
  { id: 'landsat', name: 'NASA/USGS Landsat', purpose: 'NDVI بدقة 30 م', reason: 'محتاج معالجة صور على السيرفر (مثلاً AppEEARS). NDVI المعروض هنا من MODIS بدقة 250 م.' },
  { id: 'gedi', name: 'NASA GEDI', purpose: 'ارتفاع الغطاء النباتي والكتلة الحيوية', reason: 'مسارات القياس متباعدة ومش بتغطي كل الأراضي، ومحتاج Earthdata.' },
  { id: 'grace', name: 'NASA GRACE-FO', purpose: 'المياه الجوفية والجفاف طويل المدى', reason: 'دقته مئات الكيلومترات، ومش مناسب لأرض واحدة. محتاج Earthdata.' },
]

/* ───────── الكاش في Supabase (جدول farm_geo_snapshots) ───────── */
const TTL = { nasa_power: 6 * 3600e3, soilgrids: 90 * DAY, terrain: 90 * DAY, modis_ndvi: 12 * 3600e3 }
const samePoint = (a, b) => a && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4

async function readCache(farmId, source, point) {
  try {
    const { data } = await supabase.from('farm_geo_snapshots').select('payload, fetched_at').eq('farm_id', farmId).eq('source', source).maybeSingle()
    if (!data?.payload || !samePoint(data.payload._point, point)) return null
    if (Date.now() - new Date(data.fetched_at).getTime() > TTL[source]) return null
    return { ...data.payload, cachedAt: data.fetched_at }
  } catch { return null }
}

async function writeCache(farmId, source, point, result) {
  try {
    await supabase.from('farm_geo_snapshots').upsert(
      { farm_id: farmId, source, payload: { ...result, _point: point }, as_of: result.asOf ?? null, fetched_at: new Date().toISOString() },
      { onConflict: 'farm_id,source' },
    )
  } catch { /* الكاش اختياري: لو الجدول مش موجود لسه بنكمّل عادي */ }
}

const LOADERS = {
  power: ['nasa_power', getPowerAgro],
  soil: ['soilgrids', getSoilGrids],
  terrain: ['terrain', getTerrain],
  ndvi: ['modis_ndvi', getModisNdvi],
}

// point = { lat, lng }. farmId اختياري (لو موجود بنستخدم الكاش). only = أي المصادر نجيبها.
export async function loadGeoBundle(point, { farmId = null, force = false, only = Object.keys(LOADERS) } = {}) {
  const entries = await Promise.all(only.map(async (key) => {
    const [source, fn] = LOADERS[key]
    if (farmId && !force) {
      const cached = await readCache(farmId, source, point)
      if (cached) return [key, cached]
    }
    const result = await fn(point.lat, point.lng)
    if (result.ok && farmId) writeCache(farmId, source, point, result)
    return [key, result]
  }))
  return Object.fromEntries(entries)
}
