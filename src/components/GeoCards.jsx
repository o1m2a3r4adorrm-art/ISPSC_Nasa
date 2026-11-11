// كروت بيانات الأقمار: كل كارت بيعرض المصدر والدقة وتاريخ القراءة، ولو المصدر فشل بيعرض السبب (مش رقم بديل).
import { AlertTriangle, CloudRain, Leaf, Mountain, Satellite } from 'lucide-react'
import { PENDING_SOURCES } from '../lib/geoData'
import { fa } from '../lib/format'
import './FarmDataPanel.css'

export function Tile({ label, value, unit, hint }) {
  return (
    <div className="fdp-tile">
      <span className="fdp-tile-label">{label}</span>
      <strong className="fdp-tile-value">{value}</strong>
      <span className="fdp-tile-unit">{unit || ' '}</span>
      {hint && <span className="fdp-tile-hint">{hint}</span>}
    </div>
  )
}

export function SourceLine({ result }) {
  if (!result?.ok) return null
  const parts = [`المصدر: ${result.source}`]
  if (result.resolution) parts.push(`الدقة المكانية: ${result.resolution}`)
  if (result.asOf) parts.push(`آخر قراءة: ${result.asOf}`)
  return <p className="fdp-source">{parts.join(' — ')}</p>
}

export function Unavailable({ result, loading }) {
  if (loading) return <p className="fdp-muted">جاري جلب البيانات...</p>
  if (!result) return <p className="fdp-muted">لا يوجد موقع محدد للأرض.</p>
  return <p className="fdp-unavailable"><AlertTriangle size={14} /> {result.error}. مفيش بيانات بديلة بتتعرض.</p>
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="fdp-section">
      <h4><Icon size={16} /> {title}</h4>
      {children}
    </section>
  )
}

export function WaterClimateCard({ result, loading }) {
  return (
    <Section icon={CloudRain} title="المياه والمناخ — آخر ٣٠ يوم">
      {result?.ok ? (
        <>
          <div className="fdp-tiles">
            <Tile label="أمطار ٣٠ يوم" value={fa(result.rain30Mm)} unit="مم" />
            <Tile label="أمطار ٧ أيام" value={fa(result.rain7Mm)} unit="مم" />
            <Tile label="التبخر-نتح المرجعي (ET0)" value={fa(result.et0Mm30)} unit="مم / ٣٠ يوم" hint="تقدير هارجريفز" />
            <Tile label="الميزان المائي المرجعي" value={fa(result.balanceMm30)} unit="مم" hint={result.balanceMm30 != null && result.balanceMm30 < 0 ? 'عجز: التبخر أكبر من المطر' : null} />
            <Tile label="تشبّع التربة السطحية" value={result.wetnessTop != null ? fa(result.wetnessTop * 100, 0) : '—'} unit="٪ (نموذج)" />
            <Tile label="تشبّع منطقة الجذور" value={result.wetnessRoot != null ? fa(result.wetnessRoot * 100, 0) : '—'} unit="٪ (نموذج)" />
            <Tile label="متوسط العظمى / الصغرى" value={`${fa(result.tmaxC)} / ${fa(result.tminC)}`} unit="°م" />
          </div>
          <SourceLine result={result} />
          <p className="fdp-note">
            ET0 مقدّر من حرارة NASA POWER بمعادلة هارجريفز، وهو احتياج مرجعي مش احتياج محصول بعينه. تشبّع التربة هنا ناتج نموذج MERRA-2 بدقة عشرات الكيلومترات،
            وليس قياس أقمار SMAP ولا قياس حقلك. استخدم قياس الجهاز لحالة أرضك.
          </p>
        </>
      ) : <Unavailable result={result} loading={loading} />}
    </Section>
  )
}

export function VegetationCard({ result, loading }) {
  const series = result?.ok ? result.series : []
  const prev = series.length > 1 ? series[series.length - 2] : null
  const diff = prev ? Math.round((result.latest.ndvi - prev.ndvi) * 100) / 100 : null
  return (
    <Section icon={Leaf} title="الغطاء النباتي (NDVI)">
      {result?.ok ? (
        <>
          <div className="fdp-tiles">
            <Tile label="آخر NDVI" value={fa(result.latest.ndvi, 2)} unit={result.latest.date} />
            <Tile label="التغير عن القراءة السابقة" value={diff == null ? '—' : `${diff > 0 ? '+' : ''}${fa(diff, 2)}`} unit="NDVI" />
          </div>
          <div className="fdp-spark" role="img" aria-label="سلسلة قراءات NDVI">
            {series.map((r) => (
              <div key={r.date} className="fdp-spark-col" title={`${r.date}: ${r.ndvi}`}>
                <i style={{ height: `${Math.max(4, Math.min(100, r.ndvi * 100))}%` }} />
                <small>{r.date.slice(5)}</small>
              </div>
            ))}
          </div>
          <SourceLine result={result} />
          <p className="fdp-note">بكسل MODIS مساحته ٢٥٠ م × ٢٥٠ م، فممكن يخلط أرضك بما حواليها. القيمة مؤشر اتجاه، مش قياس لمحصولك بالتحديد.</p>
        </>
      ) : <Unavailable result={result} loading={loading} />}
    </Section>
  )
}

export function TerrainCard({ result, loading }) {
  return (
    <Section icon={Mountain} title="الارتفاع والانحدار">
      {result?.ok ? (
        <>
          <div className="fdp-tiles">
            <Tile label="الارتفاع عن سطح البحر" value={fa(result.elevationM, 0)} unit="م" />
            <Tile label="الانحدار" value={result.flat ? 'مستوية تقريبًا' : fa(result.slopePct)} unit={result.flat ? 'أقل من ٢٪' : '٪'} />
          </div>
          <SourceLine result={result} />
          <p className="fdp-note">الانحدار محسوب على نافذة حوالي {fa(result.windowM, 0)} م. على الأراضي المسطّحة خطأ SRTM الرأسي أكبر من فرق الارتفاع الحقيقي، فمش بنعرض رقم انحدار تحت ٢٪.</p>
        </>
      ) : <Unavailable result={result} loading={loading} />}
    </Section>
  )
}

export function PendingSourcesCard() {
  return (
    <Section icon={Satellite} title="مصادر ناسا غير مفعّلة حاليًا">
      <p className="fdp-muted">دي مصادر محتاجة ربط مع حساب Earthdata ومعالجة على السيرفر. مش بنعرض منها أي قيمة لحد ما تتفعّل فعليًا.</p>
      <ul className="fdp-pending">
        {PENDING_SOURCES.map((s) => (
          <li key={s.id}><strong>{s.name}</strong> — {s.purpose}<small>{s.reason}</small></li>
        ))}
      </ul>
    </Section>
  )
}
