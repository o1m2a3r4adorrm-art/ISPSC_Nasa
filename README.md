# ISPSC — واجهة المزارع

تطبيق React + Supabase حقيقي. مفيش بيانات تجريبية: أي مصدر يفشل بيتعرض كـ "غير متاح" مع السبب.

## التشغيل
```bash
npm install
npm run dev
```
المتغيرات في `.env`: `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` (المفتاح العام فقط).

## الباك إند (مرة واحدة)
1. Supabase → SQL Editor → شغّل `supabase/migrations/20261111000000_soil_device_and_geo.sql`.
2. (اختياري، لو المتصفح منع الطلبات لمصادر البيانات) `supabase functions deploy geo-proxy`.

## مصادر البيانات
| المصدر | الاستخدام | الملف |
|---|---|---|
| جهاز ESP32 (متوسط ١٠ قراءات) | تحليل التربة → يتحفظ في الأرض | `src/pages/DevicePage.jsx`, `src/lib/soilAnalysis.js` |
| NASA POWER | طقس، أمطار، ET0، تشبّع التربة (نموذج) | `src/lib/geoData.js` |
| ISRIC SoilGrids | خصائص التربة (تقدير ٢٥٠ م) | `src/lib/geoData.js` |
| NASA SRTM | ارتفاع وانحدار | `src/lib/geoData.js` |
| NASA MODIS (ORNL) | NDVI | `src/lib/geoData.js` |
| NASA GIBS | طبقات الخريطة الزراعية | `src/data/mapLayersConfig.js` |
| SMAP / ECOSTRESS / Landsat / GEDI / GRACE | غير مفعّلة (محتاجة Earthdata + سيرفر) | `PENDING_SOURCES` |
