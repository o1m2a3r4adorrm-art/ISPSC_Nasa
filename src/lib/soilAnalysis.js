// src/lib/soilAnalysis.js
// حفظ وقراءة تحاليل التربة. الباك إند: جدول farm_soil_analyses + دالة save_device_soil_analysis (supabase/migrations).
import { supabase } from './supabase'

export const SOIL_STALE_DAYS = 180 // بعد المدة دي نحذّر إن التحليل قديم (قاعدة تقريبية مش معيار علمي ثابت)
const day = (v) => String(v).slice(0, 10)
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

export const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)

function describeError(error) {
  const msg = error?.message || ''
  if (error?.code === 'PGRST202' || (/save_device_soil_analysis/.test(msg) && /could not find|not find/i.test(msg))) {
    return 'الباك إند لسه ما اتحدّثش: شغّل ملف SQL الموجود في supabase/migrations من Supabase SQL Editor.'
  }
  if (error?.code === '42501') return 'مش مسموح تحفظ في الأرض دي.'
  if (error?.code === '23514') return 'قيمة من قيم التحليل خارج المدى المسموح، فمش هتتحفظ.'
  return error?.message || 'حصل خطأ غير متوقع أثناء الحفظ.'
}

export async function saveDeviceAnalysis({ farmId, result, spread, deviceName }) {
  const readings = {
    ph: result.ph, ec_dsm: result.ecDsm, moisture_percent: result.moisture, soil_temperature: result.temperature,
    nitrogen: result.n, phosphorus: result.p, potassium: result.k,
  }
  const { data, error } = await supabase.rpc('save_device_soil_analysis', {
    p_farm_id: farmId, p_readings: readings, p_samples: result.count, p_spread: spread ?? null, p_device: deviceName ?? null,
  })
  if (error) return { ok: false, error: describeError(error) }
  return { ok: true, id: data }
}

// آخر تحليل مسجّل في السجل للأرض (أو null). لو الجدول مش موجود لسه بيرجّع { error }.
export async function fetchLatestAnalysis(farmId) {
  const { data, error } = await supabase
    .from('farm_soil_analyses').select('*').eq('farm_id', farmId).order('analyzed_at', { ascending: false }).limit(1)
  if (error) return { row: null, error: error.message }
  return { row: data?.[0] ?? null, error: null }
}

export async function fetchAnalysisHistory(farmId, limit = 20) {
  const { data, error } = await supabase
    .from('farm_soil_analyses').select('*').eq('farm_id', farmId).order('analyzed_at', { ascending: false }).limit(limit)
  return { rows: data || [], error: error?.message || null }
}

// "التحليل الحالي" = اللي في صف الأرض نفسه (وده اللي توقع المحاصيل بيقراه). السجل بيحدد مصدره (جهاز/يدوي) لو القيم مطابقة.
export function pickCurrentAnalysis(farm, latestRow) {
  if (!farm) return null
  const values = {
    ph: num(farm.ph), ecDsm: num(farm.salinity), moisture: num(farm.moisture_percent), temperature: num(farm.soil_temperature),
    n: num(farm.nitrogen), p: num(farm.phosphorus), k: num(farm.potassium),
  }
  if (!Object.values(values).some((v) => v !== null)) return null
  const analyzedAt = farm.soil_analyzed_at || null
  const matchesDevice = latestRow
    && (values.ph === null || num(latestRow.ph) === values.ph)
    && (values.ecDsm === null || num(latestRow.ec_dsm) === values.ecDsm)
    && (!analyzedAt || day(latestRow.analyzed_at) === day(analyzedAt))
  return matchesDevice
    ? { ...values, source: 'device', analyzedAt: latestRow.analyzed_at, samples: latestRow.samples_count, deviceName: latestRow.device_name }
    : { ...values, source: 'manual', analyzedAt, samples: null, deviceName: null }
}
