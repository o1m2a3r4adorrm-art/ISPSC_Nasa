// لوحة تحليل التربة وبيانات الأقمار لأرض واحدة. بتُستخدم في "أرضي" (مختصرة) وفي "نتائج التحاليل" (كاملة).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, FlaskConical, RefreshCw } from 'lucide-react'
import { useGeoBundle } from '../hooks/useGeoBundle'
import { fetchAnalysisHistory, pickCurrentAnalysis, daysSince, SOIL_STALE_DAYS } from '../lib/soilAnalysis'
import { fa } from '../lib/format'
import { Tile, SourceLine, Unavailable, WaterClimateCard, VegetationCard, TerrainCard, PendingSourcesCard } from './GeoCards'
import './FarmDataPanel.css'

const SOIL_ROWS = [
  ['clay', 'طين'], ['sand', 'رمل'], ['silt', 'سلت'], ['soc', 'كربون عضوي'], ['cec', 'السعة التبادلية CEC'], ['bdod', 'الكثافة الظاهرية'],
]
const unitOf = (u) => (!u || u === '-' ? '' : u)
const dateAr = (v) => (v ? new Date(v).toLocaleDateString('ar-EG') : '—')

function CurrentAnalysis({ current }) {
  if (!current) {
    return (
      <p className="fdp-muted">
        لا يوجد تحليل تربة محفوظ للأرض دي. اعمل تحليل بالجهاز ثم اضغط «حفظ في أرضي»، أو أدخل القيم يدويًا من تعديل الأرض.
      </p>
    )
  }
  const age = daysSince(current.analyzedAt)
  const stale = age != null && age > SOIL_STALE_DAYS
  const sourceText = current.source === 'device'
    ? `جهاز ISPSC${current.deviceName ? ` (${current.deviceName})` : ''}${current.samples ? ` — متوسط ${fa(current.samples, 0)} قراءات` : ''}`
    : 'إدخال يدوي'
  return (
    <>
      <div className="fdp-tiles">
        <Tile label="الحموضة pH" value={fa(current.ph, 2)} />
        <Tile label="الملوحة EC" value={fa(current.ecDsm, 2)} unit="dS/m" />
        <Tile label="رطوبة التربة" value={fa(current.moisture)} unit="٪ وقت القياس" />
        <Tile label="حرارة التربة" value={fa(current.temperature)} unit="°م وقت القياس" />
        <Tile label="نيتروجين N" value={fa(current.n, 0)} unit="mg/kg (تقريبي)" />
        <Tile label="فوسفور P" value={fa(current.p, 0)} unit="mg/kg (تقريبي)" />
        <Tile label="بوتاسيوم K" value={fa(current.k, 0)} unit="mg/kg (تقريبي)" />
      </div>
      <p className="fdp-source">المصدر: {sourceText} — التاريخ: {dateAr(current.analyzedAt)}</p>
      {stale && (
        <p className="fdp-warn"><AlertTriangle size={14} /> التحليل عمره {fa(age, 0)} يوم. ننصح بتحليل جديد قبل ما تعتمد عليه في اختيار المحصول.</p>
      )}
      <p className="fdp-note">
        الرطوبة والحرارة بتتغير من ساعة لساعة، فهي تخص وقت القياس بس. حاليًا توقع المحاصيل بيحسب على pH والملوحة ونوع التربة والمناخ.
        قراءات N وP وK من الحساس تقريبية وللمقارنة، ومش داخلة في حساب التوافق.
      </p>
    </>
  )
}

function SoilGridsCompare({ result, loading, current }) {
  return (
    <section className="fdp-section">
      <h4><FlaskConical size={16} /> خصائص التربة من الأقمار (SoilGrids)</h4>
      {result?.ok ? (
        <>
          <div className="fdp-scroll">
            <table className="fdp-table">
              <thead><tr><th>الخاصية ({result.depth})</th><th>SoilGrids</th><th>قياس جهازك</th></tr></thead>
              <tbody>
                <tr>
                  <td>الحموضة pH</td>
                  <td>{fa(result.values.phh2o?.value, 1)}</td>
                  <td>
                    {current?.ph != null ? fa(current.ph, 2) : '—'}
                    {current?.ph != null && result.values.phh2o ? ` (الفرق ${fa(Math.abs(current.ph - result.values.phh2o.value), 1)})` : ''}
                  </td>
                </tr>
                {SOIL_ROWS.map(([key, label]) => result.values[key] && (
                  <tr key={key}><td>{label}</td><td>{fa(result.values[key].value, key === 'bdod' ? 2 : 1)} {unitOf(result.values[key].unit)}</td><td>—</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceLine result={result} />
          <p className="fdp-note">
            SoilGrids تقدير مُنمذج (تعلّم آلة) بدقة ٢٥٠ م وليس قياسًا لأرضك. لو الفرق بين قياس جهازك والتقدير كبير، فده معناه إن أرضك مختلفة عن متوسط المنطقة أو إن في خطأ في القياس. اعتمد على قياس الجهاز وكرر التحليل للتأكد.
          </p>
        </>
      ) : <Unavailable result={result} loading={loading} />}
    </section>
  )
}

export default function FarmDataPanel({ farm, full = false }) {
  const lat = farm?.gps_lat != null ? Number(farm.gps_lat) : null
  const lng = farm?.gps_lng != null ? Number(farm.gps_lng) : null
  const point = lat != null && lng != null ? { lat, lng } : null
  const geo = useGeoBundle(point, { farmId: farm?.id ?? null, only: full ? undefined : ['soil'] })
  const [hist, setHist] = useState({ farmId: null, rows: [], error: null })
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!farm?.id) return undefined
    let off = false
    ;(async () => {
      const { rows, error } = await fetchAnalysisHistory(farm.id, full ? 20 : 1)
      if (!off) setHist({ farmId: farm.id, rows, error })
    })()
    return () => { off = true }
  }, [farm?.id, full, reloadTick])

  if (!farm) return null
  const histReady = hist.farmId === farm.id
  const rows = histReady ? hist.rows : []
  const current = pickCurrentAnalysis(farm, rows[0] ?? null)

  return (
    <div className="fdp">
      <div className="fdp-head">
        <h3><FlaskConical size={18} /> تحليل التربة وبيانات الأقمار — {farm.name}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="fdp-btn" onClick={() => { setReloadTick((t) => t + 1); geo.refresh() }} disabled={geo.loading}>
            <RefreshCw size={14} /> تحديث
          </button>
          <Link to="/device" className="fdp-btn primary">تحليل جديد بالجهاز</Link>
          {!full && <Link to="/analysis" className="fdp-btn">كل التفاصيل</Link>}
        </div>
      </div>

      <section className="fdp-section">
        <h4>آخر تحليل للتربة</h4>
        {hist.error && histReady && <p className="fdp-unavailable"><AlertTriangle size={14} /> سجل التحاليل غير متاح: {hist.error}</p>}
        <CurrentAnalysis current={current} />
      </section>

      {!point ? (
        <p className="fdp-warn"><AlertTriangle size={14} /> موقع الأرض بالـ GPS غير محدد، فمش هنقدر نجيب بيانات الأقمار. حدّده من «تعديل الأرض».</p>
      ) : (
        <>
          <SoilGridsCompare result={geo.data?.soil} loading={geo.loading} current={current} />
          {full && (
            <>
              <WaterClimateCard result={geo.data?.power} loading={geo.loading} />
              <VegetationCard result={geo.data?.ndvi} loading={geo.loading} />
              <TerrainCard result={geo.data?.terrain} loading={geo.loading} />
            </>
          )}
        </>
      )}

      {full && (
        <section className="fdp-section">
          <h4>سجل التحاليل</h4>
          {rows.length === 0 ? <p className="fdp-muted">لا توجد تحاليل مسجّلة بالجهاز لحد دلوقتي.</p> : (
            <div className="fdp-scroll">
              <table className="fdp-table">
                <thead><tr><th>التاريخ</th><th>المصدر</th><th>عدد القراءات</th><th>pH</th><th>EC</th><th>رطوبة ٪</th><th>حرارة °م</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{dateAr(r.analyzed_at)}</td><td>{r.source === 'device' ? 'الجهاز' : 'يدوي'}</td><td>{fa(r.samples_count, 0)}</td>
                      <td>{fa(Number(r.ph), 2)}</td><td>{fa(Number(r.ec_dsm), 2)}</td><td>{fa(Number(r.moisture_percent))}</td><td>{fa(Number(r.soil_temperature))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {full && <PendingSourcesCard />}
    </div>
  )
}
