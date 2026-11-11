-- ISPSC — حفظ تحليل جهاز التربة في الأرض + كاش بيانات الأقمار
-- شغّله مرة واحدة من Supabase → SQL Editor. آمن لو اتشغّل أكتر من مرة.
-- ⚠️ ما اتجرّبش على قاعدة بياناتك الفعلية: راجع "الفحوصات" في آخر الملف بعد التشغيل.

begin;

-- فحص أمان: الملف مبني على إن farms.id و farms.owner_id من نوع uuid. لو لأ، يوقف بدل ما يعمل جداول غلط.
do $$
begin
  if coalesce((select data_type from information_schema.columns
               where table_schema = 'public' and table_name = 'farms' and column_name = 'id'), '') <> 'uuid' then
    raise exception 'farms.id مش من نوع uuid — غيّر نوع farm_id في الجداول دي قبل التشغيل';
  end if;
  if coalesce((select data_type from information_schema.columns
               where table_schema = 'public' and table_name = 'farms' and column_name = 'owner_id'), '') <> 'uuid' then
    raise exception 'farms.owner_id مش من نوع uuid';
  end if;
end $$;

/* ───────── 1) سجل تحاليل التربة (لا يتعدّل، بس يتضاف) ───────── */
create table if not exists public.farm_soil_analyses (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms(id) on delete cascade,
  owner_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source           text not null default 'device' check (source in ('device', 'manual')),
  device_name      text,
  samples_count    integer check (samples_count is null or samples_count between 1 and 100),
  ph               numeric(4,2) check (ph is null or ph between 0 and 14),
  ec_dsm           numeric(6,2) check (ec_dsm is null or ec_dsm between 0 and 20),
  moisture_percent numeric(5,1) check (moisture_percent is null or moisture_percent between 0 and 100),
  soil_temperature numeric(4,1) check (soil_temperature is null or soil_temperature between -10 and 70),
  nitrogen         numeric(7,1) check (nitrogen is null or nitrogen between 0 and 5000),
  phosphorus       numeric(7,1) check (phosphorus is null or phosphorus between 0 and 5000),
  potassium        numeric(7,1) check (potassium is null or potassium between 0 and 5000),
  spread           jsonb,                                   -- أقل/أعلى قراءة لكل قياس أثناء التحليل
  analyzed_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint farm_soil_analyses_has_value check (
    coalesce(ph, ec_dsm, moisture_percent, soil_temperature, nitrogen, phosphorus, potassium) is not null
  )
);

create index if not exists farm_soil_analyses_farm_time_idx
  on public.farm_soil_analyses (farm_id, analyzed_at desc);

alter table public.farm_soil_analyses enable row level security;

drop policy if exists farm_soil_analyses_select_own on public.farm_soil_analyses;
create policy farm_soil_analyses_select_own on public.farm_soil_analyses
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists farm_soil_analyses_insert_own on public.farm_soil_analyses;
create policy farm_soil_analyses_insert_own on public.farm_soil_analyses
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = (select auth.uid()))
  );

drop policy if exists farm_soil_analyses_delete_own on public.farm_soil_analyses;
create policy farm_soil_analyses_delete_own on public.farm_soil_analyses
  for delete to authenticated using (owner_id = (select auth.uid()));

/* ───────── 2) كاش بيانات الأقمار لكل أرض (يقلل الضغط على APIs ناسا/ISRIC) ───────── */
create table if not exists public.farm_geo_snapshots (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references public.farms(id) on delete cascade,
  source     text not null check (source in ('nasa_power', 'soilgrids', 'terrain', 'modis_ndvi')),
  payload    jsonb not null,
  as_of      text,                                           -- تاريخ آخر قراءة في المصدر نفسه
  fetched_at timestamptz not null default now(),
  unique (farm_id, source)
);

alter table public.farm_geo_snapshots enable row level security;

drop policy if exists farm_geo_snapshots_own on public.farm_geo_snapshots;
create policy farm_geo_snapshots_own on public.farm_geo_snapshots
  for all to authenticated
  using (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = (select auth.uid())));

/* ───────── 3) حفظ تحليل الجهاز: بيسجّل في السجل + بيحدّث بيانات الأرض (اللي توقع المحاصيل بتقراها) في عملية واحدة ───────── */
create or replace function public.save_device_soil_analysis(
  p_farm_id uuid,
  p_readings jsonb,
  p_samples integer default null,
  p_spread jsonb default null,
  p_device text default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ph    numeric := nullif(p_readings->>'ph', '')::numeric;
  v_ec    numeric := nullif(p_readings->>'ec_dsm', '')::numeric;
  v_moist numeric := nullif(p_readings->>'moisture_percent', '')::numeric;
  v_temp  numeric := nullif(p_readings->>'soil_temperature', '')::numeric;
  v_n     numeric := nullif(p_readings->>'nitrogen', '')::numeric;
  v_p     numeric := nullif(p_readings->>'phosphorus', '')::numeric;
  v_k     numeric := nullif(p_readings->>'potassium', '')::numeric;
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'لازم تسجّل دخول' using errcode = '28000';
  end if;

  if not exists (select 1 from public.farms where id = p_farm_id and owner_id = auth.uid()) then
    raise exception 'الأرض مش موجودة أو مش بتاعتك' using errcode = '42501';
  end if;

  -- القيود (check) على الجدول بترفض أي قيمة خارج المدى الفيزيائي، فمفيش رقم غلط بيتحفظ بصمت
  insert into public.farm_soil_analyses
    (farm_id, owner_id, source, device_name, samples_count, ph, ec_dsm, moisture_percent,
     soil_temperature, nitrogen, phosphorus, potassium, spread)
  values
    (p_farm_id, auth.uid(), 'device', left(p_device, 60), p_samples, v_ph, v_ec, v_moist,
     v_temp, v_n, v_p, v_k, p_spread)
  returning id into v_id;

  -- بيحدّث بس القيم اللي الجهاز رجّعها فعلاً (مش بيمسح قيمة قديمة بـ null)
  update public.farms set
    ph               = coalesce(v_ph, ph),
    salinity         = coalesce(v_ec, salinity),
    moisture_percent = coalesce(v_moist, moisture_percent),
    soil_temperature = coalesce(v_temp, soil_temperature),
    nitrogen         = coalesce(v_n, nitrogen),
    phosphorus       = coalesce(v_p, phosphorus),
    potassium        = coalesce(v_k, potassium),
    soil_analyzed_at = now(),
    updated_at       = now()
  where id = p_farm_id and owner_id = auth.uid();

  return v_id;
end;
$$;

revoke all on function public.save_device_soil_analysis(uuid, jsonb, integer, jsonb, text) from public, anon;
grant execute on function public.save_device_soil_analysis(uuid, jsonb, integer, jsonb, text) to authenticated;

commit;

/* ───────── فحوصات بعد التشغيل (شغّلها بعد ما تسجّل دخول من الموقع، أو من SQL Editor مع impersonate user) ─────────
-- 1) الجداول اتعملت وRLS مفعّل:
select relname, relrowsecurity from pg_class where relname in ('farm_soil_analyses','farm_geo_snapshots');
-- 2) نوع أعمدة farms اللي الدالة بتكتب فيها (لازم كلها موجودة):
select column_name, data_type from information_schema.columns
 where table_name = 'farms' and column_name in
 ('ph','salinity','moisture_percent','soil_temperature','nitrogen','phosphorus','potassium','soil_analyzed_at','updated_at');
*/
