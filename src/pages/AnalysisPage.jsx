// نتائج التحاليل: تحليل التربة المحفوظ لكل أرض + بيانات الأقمار (ناسا وSoilGrids) في مكان واحد.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PageLoading from '../components/PageLoading'
import FarmDataPanel from '../components/FarmDataPanel'
import '../components/FarmDataPanel.css'

export default function AnalysisPage() {
  const [state, setState] = useState({ loading: true, farms: [], error: '' })
  const [farmId, setFarmId] = useState('')

  useEffect(() => {
    let off = false
    ;(async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) { if (!off) setState({ loading: false, farms: [], error: 'لازم تسجّل دخول.' }); return }
      const { data, error } = await supabase.from('farms').select('*').eq('owner_id', userData.user.id).order('created_at', { ascending: true })
      if (off) return
      setState({ loading: false, farms: data || [], error: error ? `تعذّر تحميل الأراضي: ${error.message}` : '' })
    })()
    return () => { off = true }
  }, [])

  if (state.loading) return <PageLoading label="جاري تحميل نتائج التحاليل..." />

  const farm = state.farms.find((f) => f.id === farmId) || state.farms[0] || null

  return (
    <div style={{ padding: '24px 16px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--tl)' }}>الرئيسية / نتائج التحاليل</div>
        <h1 style={{ margin: '4px 0', color: 'var(--dark)', display: 'flex', alignItems: 'center', gap: 8 }}><FlaskConical size={22} /> نتائج التحاليل</h1>
        <p style={{ margin: 0, color: 'var(--tm)' }}>تحليل التربة المحفوظ لأرضك، مع بيانات الأقمار الصناعية لنفس الموقع. كل رقم عليه مصدره وتاريخه.</p>
      </div>

      {state.error && <p className="fdp-unavailable">{state.error}</p>}

      {state.farms.length === 0 ? (
        <p className="fdp-muted">لسه مفيش أرض مسجلة. <Link to="/my-farm">سجّل أرضك</Link> الأول.</p>
      ) : (
        <>
          {state.farms.length > 1 && (
            <div className="fdp-save-actions" style={{ marginTop: 12 }}>
              {state.farms.map((f) => (
                <button key={f.id} type="button" className={`fdp-btn ${f.id === farm.id ? 'primary' : ''}`} onClick={() => setFarmId(f.id)}>{f.name}</button>
              ))}
            </div>
          )}
          <FarmDataPanel key={farm.id} farm={farm} full />
        </>
      )}
    </div>
  )
}
