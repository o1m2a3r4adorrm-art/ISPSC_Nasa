import { useEffect, useRef, useState } from 'react'
import { getLinkedDevice, saveLinkedDevice, updateLinkedDevice, clearLinkedDevice, createLinkedDevice } from '../lib/linkedDevice'
import {
  getBleSupport, pickSoilDevice, openSoilConnection, describeBleError, averageReadings, SOIL_STATUS,
} from '../lib/deviceBle'
import SaveToFarmPanel from '../components/SaveToFarmPanel'
import './DevicePage.css'

// لو مفيش قراءة جاية من الجهاز المدة دي (بالمللي ثانية) نعرض تنبيه
const STALE_MS = 6000
// لو الاتصال اتقطع فجأة: عدد محاولات إعادة الاتصال التلقائية والفاصل بينها
const RECONNECT_TRIES = 3
const RECONNECT_DELAY_MS = 1500

// التحليل بالمتوسط: عدد القراءات السليمة المطلوبة، وأقصى انتظار بين قراءتين قبل ما نعتبر التحليل فشل
const SAMPLE_TARGET = 10
const SAMPLE_GAP_MS = 15000
// لو القراءات متباعدة أكتر من الحدود دي نحذّر المستخدم (حدود تقديرية، تتظبط بعد تجربة الجهاز فعليًا)
const SPREAD_WARN = { moisture: 5, ph: 0.5 }
const EMPTY_SESSION = { phase: 'idle', count: 0, result: null, spread: null }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fmt = (v, digits) => (typeof v === 'number' ? v.toLocaleString('ar-EG', { maximumFractionDigits: digits }) : '—')

// الخانات اللي بتتعرض في القراءة الحية
const TILES = [
  { key: 'moisture', label: 'رطوبة التربة', unit: '٪', digits: 1 },
  { key: 'temperature', label: 'حرارة التربة', unit: '°م', digits: 1 },
  { key: 'ecDsm', label: 'الملوحة (EC)', unit: 'dS/m', digits: 2 },
  { key: 'ph', label: 'الحموضة pH', unit: '', digits: 2 },
  { key: 'n', label: 'نيتروجين N', unit: 'mg/kg', digits: 0 },
  { key: 'p', label: 'فوسفور P', unit: 'mg/kg', digits: 0 },
  { key: 'k', label: 'بوتاسيوم K', unit: 'mg/kg', digits: 0 },
]

/* ───── أيقونات ───── */
const IconProbe = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="2.5" width="12" height="9" rx="2" />
    <path d="M9 6h6" />
    <path d="M12 11.5V21" />
    <path d="M9.5 21h5" />
  </svg>
)

const IconBluetooth = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 7l10 10-5 5V2l5 5L7 17" />
  </svg>
)

const IconCheck = () => (
  <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className="dv-check-path" d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)

/* ───── الرادار ───── */
function Radar({ active, children }) {
  return (
    <div className={`dv-radar ${active ? 'is-active' : ''}`} aria-hidden="true">
      <span className="dv-ring r1" />
      <span className="dv-ring r2" />
      <span className="dv-ring r3" />
      {active && <span className="dv-sweep" />}
      <div className="dv-core">{children}</div>
    </div>
  )
}

function DevicePage() {
  // idle → scanning (نافذة اختيار المتصفح مفتوحة) → connecting → connected  |  lost (انقطع الاتصال)
  // ملاحظة: اتصال البلوتوث بيعيش مع الصفحة الحالية بس، فبعد تحديث الصفحة لازم المستخدم يضغط اتصال تاني.
  const support = getBleSupport()
  const [linked, setLinked] = useState(() => getLinkedDevice())
  const [stage, setStage] = useState('idle')
  const [reconnecting, setReconnecting] = useState(false)
  const [info, setInfo] = useState(null)       // { id, name } الجهاز الحالي
  const [packet, setPacket] = useState(null)   // آخر رسالة وصلت من الجهاز
  const [stale, setStale] = useState(false)
  const [connectError, setConnectError] = useState('')
  // رسالة طلب إذن البلوتوث (بتظهر لما المستخدم يضغط "اتصال بالجهاز")
  const [askBluetooth, setAskBluetooth] = useState(false)
  const [bluetoothDenied, setBluetoothDenied] = useState(false)
  // جلسة التحليل: idle → running (بتجمع ١٠ قراءات) → done (المتوسط) | failed (القراءات وقفت)
  const [session, setSession] = useState(EMPTY_SESSION)

  const runRef = useRef(0)         // رقم المحاولة الحالية: أي محاولة أقدم بتتجاهل نتيجتها
  const connRef = useRef(null)     // الاتصال الحالي
  const deviceRef = useRef(null)   // جهاز البلوتوث (BluetoothDevice)
  const lastAtRef = useRef(0)
  const sessionRef = useRef({ running: false, seqs: new Set(), samples: [], lastAt: 0 })

  // Esc = رفض
  useEffect(() => {
    if (!askBluetooth) return
    const onKey = (e) => { if (e.key === 'Escape') denyBluetooth() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [askBluetooth])

  // لو الصفحة اتقفلت: نقفل اتصال البلوتوث
  useEffect(() => () => {
    runRef.current += 1
    connRef.current?.close()
    connRef.current = null
  }, [])

  // مراقبة انقطاع القراءات
  useEffect(() => {
    if (stage !== 'connected') return undefined
    lastAtRef.current = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - lastAtRef.current > STALE_MS) setStale(true)
    }, 1000)
    return () => clearInterval(timer)
  }, [stage])

  // لو التحليل شغال والقراءات السليمة وقفت: نوقفه بدل ما يفضل معلّق
  useEffect(() => {
    if (session.phase !== 'running') return undefined
    const timer = setInterval(() => {
      const s = sessionRef.current
      if (s.running && Date.now() - s.lastAt > SAMPLE_GAP_MS) {
        s.running = false
        setSession((prev) => ({ ...prev, phase: 'failed' }))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [session.phase])

  function resetSession() {
    sessionRef.current.running = false
    setSession(EMPTY_SESSION)
  }

  // بيجمع القراءات السليمة بس، وبيتجاهل أي رسالة بنفس رقم القراءة (seq) عشان ما تتحسبش مرتين
  function collectSample(p) {
    const s = sessionRef.current
    if (!s.running || p.status !== SOIL_STATUS.OK || !p.hasData || s.seqs.has(p.seq)) return
    s.seqs.add(p.seq)
    s.samples.push(p)
    s.lastAt = Date.now()
    if (s.samples.length >= SAMPLE_TARGET) finishMeasurement()
    else setSession((prev) => ({ ...prev, count: s.samples.length }))
  }

  function finishMeasurement() {
    const s = sessionRef.current
    s.running = false
    const result = { ...averageReadings(s.samples), at: Date.now() }
    const spread = {}
    for (const t of TILES) {
      const vals = s.samples.map((x) => x[t.key]).filter((v) => typeof v === 'number')
      spread[t.key] = vals.length ? [Math.min(...vals), Math.max(...vals)] : null
    }
    setSession({ phase: 'done', count: s.samples.length, result, spread })
    // نحفظ المتوسط كآخر قراءة للجهاز (بيظهر في الإعدادات)
    updateLinkedDevice({
      lastSyncAt: new Date().toISOString(),
      reading: {
        moisture: result.moisture, temperature: result.temperature, salinity: result.ecDsm,
        ph: result.ph, n: result.n, p: result.p, k: result.k,
        samples: result.count, at: new Date().toISOString(),
      },
    })
  }

  function startMeasurement() {
    sessionRef.current = { running: true, seqs: new Set(), samples: [], lastAt: Date.now() }
    setSession((prev) => ({ ...prev, phase: 'running', count: 0 }))
  }

  function cancelMeasurement() {
    sessionRef.current.running = false
    setSession((prev) => ({ ...prev, phase: prev.result ? 'done' : 'idle', count: 0 }))
  }

  function handlePacket(p) {
    lastAtRef.current = Date.now()
    setStale(false)
    setPacket(p)
    collectSample(p)
  }

  async function openConnection(device, token) {
    const conn = await openSoilConnection(device, {
      onPacket: handlePacket,
      onDisconnected: () => { if (token === runRef.current) recoverConnection(token) },
    })
    if (token !== runRef.current) { conn.close(); return false }
    connRef.current = conn
    return true
  }

  function markConnected(device) {
    const id = device.name || 'ISPSC'
    setInfo({ id, name: 'ISPSC Pro' })
    // بيتحفظ عشان يظهر في الإعدادات. القراءة الحقيقية هتتربط بالأرض في خطوة الحفظ.
    const record = { ...createLinkedDevice({ id, name: 'ISPSC Pro' }), reading: null }
    saveLinkedDevice(record)
    setLinked(record)
    setPacket(null)
    setStale(false)
    resetSession()
    setStage('connected')
  }

  // الاتصال اتقطع فجأة (الجهاز اتقفل أو بعيد): نحاول نرجّع الاتصال تلقائي كام مرة
  async function recoverConnection(token) {
    connRef.current?.close()
    connRef.current = null
    setReconnecting(true)
    resetSession()
    setStage('connecting')
    for (let i = 0; i < RECONNECT_TRIES; i += 1) {
      await sleep(RECONNECT_DELAY_MS)
      if (token !== runRef.current) return
      try {
        if (await openConnection(deviceRef.current, token)) {
          setReconnecting(false)
          setStage('connected')
          return
        }
        return
      } catch { /* نجرّب تاني */ }
    }
    if (token === runRef.current) { setReconnecting(false); setStage('lost') }
  }

  // لازم تتنده من ضغطة زرار مباشرة (شرط من المتصفح لفتح نافذة اختيار الجهاز)
  async function connectFlow() {
    runRef.current += 1
    const token = runRef.current
    setConnectError('')
    setReconnecting(false)
    setStage('scanning')
    let device
    try {
      device = await pickSoilDevice()
    } catch (err) {
      if (token !== runRef.current) return
      const d = describeBleError(err)
      console.error('[ISPSC BLE] requestDevice', err)
      setStage('idle')
      if (!d.cancelled) setConnectError(d)
      return
    }
    if (token !== runRef.current) return
    connRef.current?.close()
    connRef.current = null
    deviceRef.current = device
    setInfo({ id: device.name || 'ISPSC', name: 'ISPSC Pro' })
    setStage('connecting')
    try {
      if (await openConnection(device, token)) markConnected(device)
    } catch (err) {
      if (token !== runRef.current) return
      console.error('[ISPSC BLE] connect', err)
      setStage('idle')
      setConnectError(describeBleError(err))
    }
  }

  function requestConnect() { setBluetoothDenied(false); setAskBluetooth(true) }
  function allowBluetooth() { setAskBluetooth(false); connectFlow() }
  function denyBluetooth() { setAskBluetooth(false); setBluetoothDenied(true) }

  function cancelScan() { runRef.current += 1; setStage('idle') }
  function disconnect() {
    runRef.current += 1
    connRef.current?.close()
    connRef.current = null
    deviceRef.current = null
    clearLinkedDevice()
    setLinked(null)
    setPacket(null)
    resetSession()
    setStage('idle')
  }
  function unlink() { clearLinkedDevice(); setLinked(null) }

  // حالة القراءة الحية (رسالة فوق اللوحة)
  let banner = { tone: 'wait', text: 'في انتظار أول قراءة من الجهاز...' }
  if (stale) banner = { tone: 'warn', text: 'مفيش بيانات جاية من الجهاز من أكتر من ٦ ثواني. اتأكد إنه شغال وقريب منك.' }
  else if (packet?.status === SOIL_STATUS.DETECTING) banner = { tone: 'warn', text: 'الجهاز بيدوّر على المجسّ. اتأكد إن الأسلاك متوصّلة والمجسّ مغروس في التربة.' }
  else if (packet?.status === SOIL_STATUS.READ_FAILED) banner = { tone: 'warn', text: 'المجسّ موجود لكن القراءة فشلت. بنعيد المحاولة...' }
  else if (packet?.status === SOIL_STATUS.OK) {
    banner = session.phase === 'running'
      ? { tone: 'ok', text: 'بنجمع القراءات... متحرّكش المجسّ لحد ما نخلّص.' }
      : { tone: 'ok', text: 'المجسّ جاهز للتحليل' }
  }
  const running = session.phase === 'running'
  const canStart = packet?.status === SOIL_STATUS.OK && !stale
  const result = session.phase === 'done' ? session.result : null
  const unstable = result && session.spread && Object.entries(SPREAD_WARN).some(([k, lim]) => {
    const r = session.spread[k]
    return r && r[1] - r[0] > lim
  })

  return (
    <div className="dv-page">
      <div className="dv-header">
        <div className="dv-breadcrumb">الرئيسية / جهاز التحليل</div>
        <h1>جهاز تحليل التربة</h1>
        <p>اتصل بجهاز ISPSC Pro القريب منك لاستقبال نتائج التحليل.</p>
      </div>

      <div className="dv-card" aria-live="polite">
        {stage === 'idle' && (
          <div className="dv-stage" key="idle">
            <Radar><IconProbe /></Radar>
            {support.ok ? (
              <>
                <h2>لا يوجد جهاز متصل</h2>
                <p>شغّل الجهاز وقرّبه منك، ثم اضغط على زر الاتصال.</p>
                <button type="button" className="dv-primary-btn" onClick={requestConnect}>
                  اتصال بالجهاز
                </button>
                {linked && (
                  <div className="dv-last-device">
                    <span>آخر جهاز مربوط: {linked.name} · {linked.id}</span>
                    <button type="button" className="dv-link-btn" onClick={unlink}>إلغاء الربط</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2>المتصفح ده مش بيدعم الاتصال بالجهاز</h2>
                <p>
                  {support.reason === 'insecure'
                    ? 'الاتصال بالبلوتوث بيشتغل بس على رابط آمن (https). افتح الموقع من الرابط الرسمي.'
                    : 'استخدم Chrome أو Edge على الكمبيوتر، أو Chrome على الأندرويد. الأيفون محتاج متصفح بيدعم الويب بلوتوث زي Bluefy.'}
                </p>
              </>
            )}
            {bluetoothDenied && (
              <div className="dv-denied" role="alert">
                لازم تسمح بالاتصال بالبلوتوث عشان نقدر نبحث عن الجهاز ونتصل بيه.
              </div>
            )}
            {connectError && (
              <div className="dv-denied" role="alert">
                {connectError.message}
                {connectError.detail && <small className="dv-err-detail" dir="ltr">{connectError.detail}</small>}
              </div>
            )}
          </div>
        )}

        {stage === 'scanning' && (
          <div className="dv-stage" key="scanning">
            <Radar active><IconProbe /></Radar>
            <h2>جاري البحث عن أجهزة قريبة...</h2>
            <p>اختار جهازك من القايمة اللي ظهرت من المتصفح (اسمه بيبدأ بـ ISPSC).</p>
            <button type="button" className="dv-ghost-btn" onClick={cancelScan}>إلغاء</button>
          </div>
        )}

        {stage === 'connecting' && (
          <div className="dv-stage" key="connecting">
            <Radar active><IconProbe /></Radar>
            <h2>{reconnecting ? 'انقطع الاتصال... جاري إعادة الاتصال' : 'جاري الاتصال بالجهاز...'}</h2>
            <p>{info?.name} · {info?.id}</p>
          </div>
        )}

        {stage === 'connected' && (
          <div className="dv-stage" key="connected">
            <div className="dv-success"><IconCheck /></div>
            <h2 className="dv-success-title">تم الاتصال بنجاح</h2>
            <p>أنت الآن متصل بالجهاز {info?.name} ({info?.id}).</p>

            <div className="dv-live">
              <div className={`dv-banner dv-banner-${banner.tone}`} role="status">{banner.text}</div>

              {running && (
                <div className="dv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={SAMPLE_TARGET} aria-valuenow={session.count}>
                  <div className="dv-progress-bar" style={{ width: `${(session.count / SAMPLE_TARGET) * 100}%` }} />
                  <span>{fmt(session.count, 0)} / {fmt(SAMPLE_TARGET, 0)} قراءات</span>
                </div>
              )}

              {session.phase === 'failed' && (
                <div className="dv-banner dv-banner-warn" role="alert">
                  القراءات وقفت قبل ما نوصل لـ {fmt(SAMPLE_TARGET, 0)} قراءات سليمة (وصلنا {fmt(session.count, 0)}). اتأكد إن المجسّ مغروس كويس في التربة وحاول تاني.
                </div>
              )}

              {result && (
                <>
                  <div className="dv-banner dv-banner-ok" role="status">
                    متوسط {fmt(result.count, 0)} قراءات
                  </div>
                  {unstable && (
                    <div className="dv-banner dv-banner-warn" role="alert">
                      القراءات متباعدة عن بعض. غالبًا المجسّ اتحرّك أو التربة مش متجانسة، فالأفضل تعيد التحليل.
                    </div>
                  )}
                  <div className="dv-tiles">
                    {TILES.map((t) => {
                      const r = session.spread?.[t.key]
                      return (
                        <div className="dv-tile" key={t.key}>
                          <span className="dv-tile-label">{t.label}</span>
                          <strong className="dv-tile-value">{fmt(result[t.key], t.digits)}</strong>
                          <span className="dv-tile-unit">{t.unit}</span>
                          {r && <span className="dv-tile-range">{fmt(r[0], t.digits)} – {fmt(r[1], t.digits)}</span>}
                        </div>
                      )
                    })}
                  </div>
                  <SaveToFarmPanel
                    key={result.at}
                    result={result}
                    spread={session.spread}
                    deviceName={info?.id}
                    unstable={Boolean(unstable)}
                    defaultFarmId={linked?.farmId ?? null}
                  />
                  <p className="dv-note">
                    النتيجة هي متوسط القراءات، والسطر الصغير تحت كل قيمة هو أقل وأعلى قراءة. قراءات النيتروجين والفوسفور والبوتاسيوم تقريبية ومناسبة للمقارنة، مش بديل لتحليل المعمل.
                  </p>
                </>
              )}

              <div className="dv-actions">
                {!running && (
                  <button type="button" className="dv-primary-btn" onClick={startMeasurement} disabled={!canStart}>
                    {result ? 'إعادة التحليل' : `ابدأ التحليل (${fmt(SAMPLE_TARGET, 0)} قراءات)`}
                  </button>
                )}
                {running && (
                  <button type="button" className="dv-ghost-btn" onClick={cancelMeasurement}>إلغاء التحليل</button>
                )}
              </div>
            </div>

            <button type="button" className="dv-ghost-btn" onClick={disconnect}>قطع الاتصال</button>
          </div>
        )}

        {stage === 'lost' && (
          <div className="dv-stage" key="lost">
            <Radar><IconProbe /></Radar>
            <h2>انقطع الاتصال بالجهاز</h2>
            <p>اتأكد إن الجهاز شغال وقريب منك، وبعدها اضغط إعادة الاتصال.</p>
            <button type="button" className="dv-primary-btn" onClick={connectFlow}>إعادة الاتصال</button>
            <button type="button" className="dv-ghost-btn" style={{ marginTop: 10 }} onClick={disconnect}>إلغاء</button>
          </div>
        )}
      </div>

      {askBluetooth && (
        <div className="dv-overlay" onClick={denyBluetooth}>
          <div
            className="dv-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dv-bt-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dv-dialog-icon"><IconBluetooth /></div>
            <h3 id="dv-bt-title">السماح بالاتصال بالبلوتوث؟</h3>
            <p>
              عايز نشغّل البلوتوث عشان نبحث عن جهاز تحليل التربة القريب منك ونتصل بيه.
            </p>
            <div className="dv-dialog-actions">
              <button type="button" className="dv-primary-btn dv-dialog-btn" onClick={allowBluetooth} autoFocus>
                سماح
              </button>
              <button type="button" className="dv-ghost-btn dv-dialog-btn" onClick={denyBluetooth}>
                رفض
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DevicePage
