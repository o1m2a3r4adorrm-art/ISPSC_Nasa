// src/components/DeviceLinkSection.jsx
// قسم "ربط بجهاز التحليل" في الإعدادات. كل اللي بيتعرض هنا حقيقي: اسم الجهاز، الأرض المرتبطة (من حسابك)، وآخر تحليل اتعمل بالجهاز.
// مفيش بطارية ولا "متصل" ولا مزامنة شكلية: الجهاز بيبعت بالبلوتوث لصفحة "جهاز التحليل" بس.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLinkedDevice, updateLinkedDevice, clearLinkedDevice } from '../lib/linkedDevice'
import './DeviceLinkSection.css'

function timeAgo(iso) {
  if (!iso) return '—'
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'الآن'
  const fmt = (n) => n.toLocaleString('ar-EG')
  if (minutes < 60) return `منذ ${fmt(minutes)} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `منذ ${fmt(hours)} ساعة`
  return `منذ ${fmt(Math.floor(hours / 24))} يوم`
}

const fmtNum = (n, digits = 0) => (typeof n === 'number' ? n.toLocaleString('ar-EG', { maximumFractionDigits: digits }) : '—')

function DeviceLinkSection() {
  const navigate = useNavigate()
  const device = useLinkedDevice()
  const [farms, setFarms] = useState([])
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  useEffect(() => {
    let off = false
    ;(async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) return
      const { data } = await supabase.from('farms').select('id, name').eq('owner_id', userData.user.id).order('created_at', { ascending: true })
      if (!off) setFarms(data || [])
    })()
    return () => { off = true }
  }, [])

  if (!device) {
    return (
      <div className="dls-empty">
        <p className="section-note">اربط جهاز ISPSC Pro عشان تحلل التربة وتحفظ النتيجة في أرضك.</p>
        <button type="button" className="btn-premium secondary" onClick={() => navigate('/device')}>ربط جهاز</button>
      </div>
    )
  }

  function startRename() { setNameDraft(device.name); setRenaming(true) }
  function saveRename(e) {
    e?.preventDefault()
    const name = nameDraft.trim()
    if (name) updateLinkedDevice({ name })
    setRenaming(false)
  }
  function unlink() { clearLinkedDevice(); setConfirmUnlink(false) }

  return (
    <div className="dls-card">
      <div className="dls-head">
        <div className="dls-title">
          {renaming ? (
            <form className="dls-rename" onSubmit={saveRename}>
              <input
                type="text" value={nameDraft} maxLength={30} autoFocus aria-label="اسم الجهاز"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false) }}
              />
              <button type="submit" className="dls-mini primary">حفظ</button>
              <button type="button" className="dls-mini" onClick={() => setRenaming(false)}>إلغاء</button>
            </form>
          ) : (
            <>
              <strong>{device.name}</strong>
              <small dir="ltr">{device.id}</small>
            </>
          )}
        </div>
      </div>

      <div className="dls-rows">
        <div><span>آخر تحليل بالجهاز</span><strong>{device.lastSyncAt ? timeAgo(device.lastSyncAt) : 'لسه ما اتعملش تحليل'}</strong></div>
        <div>
          <span>الأرض الافتراضية عند الحفظ</span>
          <select
            value={device.farmId ?? ''}
            aria-label="الأرض الافتراضية للحفظ"
            onChange={(e) => updateLinkedDevice({ farmId: e.target.value || null })}
          >
            <option value="">غير محددة</option>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>

      {device.reading && (
        <>
          <div className="dls-sub">
            آخر تحليل <small>({timeAgo(device.reading.at)}{device.reading.samples ? ` · متوسط ${fmtNum(device.reading.samples)} قراءات` : ''})</small>
          </div>
          <div className="dls-reading">
            <div><strong>{fmtNum(device.reading.moisture, 1)}٪</strong><span>الرطوبة</span></div>
            <div><strong>{fmtNum(device.reading.temperature, 1)}°م</strong><span>الحرارة</span></div>
            <div><strong>{fmtNum(device.reading.salinity, 2)}</strong><span>الملوحة dS/m</span></div>
            <div><strong>{fmtNum(device.reading.ph, 2)}</strong><span>pH</span></div>
          </div>
        </>
      )}

      {confirmUnlink ? (
        <div className="dls-confirm" role="alert">
          <p>متأكد إنك عايز تفصل الجهاز؟ التحاليل المحفوظة في أرضك هتفضل زي ما هي.</p>
          <div className="dls-actions">
            <button type="button" className="btn-danger" onClick={unlink}>تأكيد الفصل</button>
            <button type="button" className="btn-premium secondary" onClick={() => setConfirmUnlink(false)}>إلغاء</button>
          </div>
        </div>
      ) : (
        <div className="dls-actions">
          <button type="button" className="btn-premium secondary" onClick={startRename} disabled={renaming}>إعادة تسمية</button>
          <button type="button" className="btn-premium secondary" onClick={() => navigate('/device')}>صفحة الجهاز</button>
          <button type="button" className="dls-unlink" onClick={() => setConfirmUnlink(true)}>فصل الجهاز</button>
        </div>
      )}
    </div>
  )
}

export default DeviceLinkSection
