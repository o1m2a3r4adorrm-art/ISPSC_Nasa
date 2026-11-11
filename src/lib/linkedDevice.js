// src/lib/linkedDevice.js
// حالة "جهاز التحليل المربوط" — مشتركة بين صفحة الجهاز (/device) وصفحة الإعدادات.
// TODO: Backend Integration — دلوقتي الحالة بتتخزّن في المتصفح (localStorage) كمحاكاة.
// لما الباك يجهز: كل دالة هنا تتحول لطلب للسيرفر (جدول أجهزة: device_id ↔ user_id)، والواجهة مش هتتغيّر.
import { useMemo, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'ispsc_linked_device'
const CHANGE_EVENT = 'ispsc-linked-device-change'

function readRaw() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function getLinkedDevice() {
  const raw = readRaw()
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// بيبني بيانات الجهاز المربوط من الجهاز اللي المستخدم اختاره في صفحة البحث
export function createLinkedDevice(found) {
  const now = new Date().toISOString()
  return {
    id: found.id,
    name: found.name,
    linkedAt: now,
    // مفيش بطارية ولا حالة "متصل" هنا: الجهاز مابيبعتهمش، والاتصال بالبلوتوث بيعيش مع صفحة الجهاز بس.
    lastSyncAt: null, // وقت آخر تحليل (متوسط قراءات) خلص من الجهاز
    farmId: null, // الأرض اللي الجهاز مربوط بيها (اختياري، وبتتحفظ محليًا في المتصفح)
    reading: null, // آخر متوسط تحليل حقيقي من الجهاز
  }
}

export function saveLinkedDevice(device) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(device)) } catch { /* التخزين مش متاح */ }
  emitChange()
}

export function updateLinkedDevice(patch) {
  const current = getLinkedDevice()
  if (!current) return
  saveLinkedDevice({ ...current, ...patch })
}

export function clearLinkedDevice() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* التخزين مش متاح */ }
  emitChange()
}

function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', callback) // لو اتغيّر من تاب تاني
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

// Hook: بيرجّع الجهاز المربوط (أو null) وبيتحدّث لوحده لما يتغيّر
export function useLinkedDevice() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  return useMemo(() => {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }, [raw])
}