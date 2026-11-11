// زرار "حفظ في أرضي" بعد ما التحليل (متوسط ١٠ قراءات) يخلص: بيختار الأرض وبيحفظ في الباك إند.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { saveDeviceAnalysis } from '../lib/soilAnalysis'
import './FarmDataPanel.css'

export default function SaveToFarmPanel({ result, spread, deviceName, unstable, defaultFarmId }) {
  const [farms, setFarms] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [farmId, setFarmId] = useState('')
  const [save, setSave] = useState({ phase: 'idle', error: '' })

  useEffect(() => {
    let off = false
    ;(async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) { if (!off) setLoadError('لازم تسجّل دخول عشان تحفظ التحليل.'); return }
      const { data, error } = await supabase
        .from('farms').select('id, name, soil_analyzed_at').eq('owner_id', userData.user.id).order('created_at', { ascending: true })
      if (off) return
      if (error) { setLoadError(`تعذّر تحميل أراضيك: ${error.message}`); return }
      const list = data || []
      setFarms(list)
      const preferred = list.find((f) => f.id === defaultFarmId) || (list.length === 1 ? list[0] : null)
      if (preferred) setFarmId(preferred.id)
    })()
    return () => { off = true }
  }, [defaultFarmId])

  const selected = farms?.find((f) => f.id === farmId) || null
  const hasValue = [result.ph, result.ecDsm, result.moisture, result.temperature, result.n, result.p, result.k].some((v) => typeof v === 'number')

  async function handleSave() {
    if (!selected || save.phase === 'saving') return
    setSave({ phase: 'saving', error: '' })
    const res = await saveDeviceAnalysis({ farmId: selected.id, result, spread, deviceName })
    setSave(res.ok ? { phase: 'saved', error: '' } : { phase: 'error', error: res.error })
  }

  return (
    <div className="fdp-save">
      <h4>حفظ التحليل في أرضي</h4>
      {loadError ? <p className="fdp-unavailable">{loadError}</p> : farms === null ? (
        <p className="fdp-muted"><Loader2 size={14} className="spin" /> جاري تحميل أراضيك...</p>
      ) : farms.length === 0 ? (
        <p className="fdp-muted">لسه معندكش أرض مسجلة. <Link to="/my-farm">سجّل أرضك الأول</Link> وبعدها ارجع احفظ التحليل.</p>
      ) : (
        <>
          <select value={farmId} onChange={(e) => { setFarmId(e.target.value); setSave({ phase: 'idle', error: '' }) }} aria-label="اختار الأرض">
            <option value="">اختار الأرض اللي أخدت منها العينة</option>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {selected?.soil_analyzed_at && save.phase !== 'saved' && (
            <p className="fdp-note">
              الأرض دي فيها تحليل بتاريخ {new Date(selected.soil_analyzed_at).toLocaleDateString('ar-EG')}. الحفظ هيحدّث بيانات الأرض الحالية بقيم الجهاز
              (القيم اللي الجهاز ما قاسهاش بتفضل زي ما هي)، وتحليل الجهاز بيتسجّل في سجل التحاليل.
            </p>
          )}
          {unstable && <p className="fdp-warn">القراءات متباعدة. الأفضل تعيد التحليل قبل الحفظ.</p>}
          {!hasValue && <p className="fdp-warn">مفيش قيم صالحة للحفظ في النتيجة دي.</p>}
          <div className="fdp-save-actions">
            <button type="button" className="fdp-btn primary" onClick={handleSave} disabled={!selected || !hasValue || save.phase === 'saving' || save.phase === 'saved'}>
              {save.phase === 'saving' ? 'جاري الحفظ...' : save.phase === 'saved' ? 'تم الحفظ' : 'حفظ في أرضي'}
            </button>
          </div>
          {save.phase === 'error' && <p className="fdp-unavailable">{save.error}</p>}
          {save.phase === 'saved' && (
            <p className="fdp-ok">
              <CheckCircle2 size={14} /> اتحفظ في «{selected.name}».{' '}
              <Link to="/my-farm">عرض في أرضي</Link> · <Link to="/analysis">نتائج التحاليل</Link> · <Link to="/predict">توقع المحاصيل</Link>
            </p>
          )}
        </>
      )}
    </div>
  )
}
