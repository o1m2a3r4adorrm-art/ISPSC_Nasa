export const fa = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ar-EG', { maximumFractionDigits: d }) : '—')
