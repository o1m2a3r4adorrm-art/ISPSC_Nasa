// supabase/functions/geo-proxy/index.ts
// وسيط خفيف لطلبات GET على مصادر البيانات الجغرافية (بيحل مشكلة CORS لو المتصفح اتمنع).
// - بيقبل بس https وبس مواقع في القائمة البيضاء (حماية من SSRF).
// - لازم المستخدم يكون مسجّل دخول (verify_jwt مفعّل افتراضياً).
// نشر:  supabase functions deploy geo-proxy
const ALLOWED_HOSTS = new Set([
  'rest.isric.org',          // SoilGrids
  'api.opentopodata.org',    // ارتفاعات SRTM
  'modis.ornl.gov',          // MODIS NDVI (ORNL DAAC)
  'power.larc.nasa.gov',     // NASA POWER
])
const MAX_BYTES = 2_000_000
const TIMEOUT_MS = 25_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let target: URL
  try {
    const { url } = await req.json()
    target = new URL(String(url))
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.port || !ALLOWED_HOSTS.has(target.hostname)) {
    return json({ error: 'host_not_allowed' }, 403)
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await upstream.text()
    if (text.length > MAX_BYTES) return json({ error: 'response_too_large' }, 502)
    if (!upstream.ok) return json({ error: 'upstream_error', status: upstream.status }, 502)
    return new Response(text, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch {
    return json({ error: 'upstream_unreachable' }, 502)
  }
})
