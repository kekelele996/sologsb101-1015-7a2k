/**
 * 古树历史时间线派生 hook
 * 把树体检查、复壮措施、加固件、长势复评聚合为一条按日期倒序的时间线，
 * 被树体检查页与复评页消费。
 */
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { liveQuery } from 'dexie'
import type { Survey } from '../types/survey'
import type { Measure } from '../types/measure'
import type { Support } from '../types/support'
import type { Review } from '../types/review'
import { db, initDatabase } from '../utils/db'

/** 时间线条目类型 */
export type HistoryKind = 'survey' | 'measure' | 'support' | 'review'

export interface HistoryItem {
  key: string
  kind: HistoryKind
  date: string
  title: string
  detail: string
  /** 状态标签（措施状态 / 长势等级等） */
  badge: string
}

export const HISTORY_KIND_LABEL: Record<HistoryKind, string> = {
  survey: '树体检查',
  measure: '复壮措施',
  support: '加固件',
  review: '长势复评',
}

/** 纯函数：把四类记录聚合成时间线 */
export function buildHistory(
  surveys: Survey[],
  measures: Measure[],
  supports: Support[],
  reviews: Review[]
): HistoryItem[] {
  const items: HistoryItem[] = []
  surveys.forEach((row) => {
    items.push({
      key: `survey-${row.id}`,
      kind: 'survey',
      date: row.date,
      title: `树体检查 · 树高 ${row.heightM} m / 胸径 ${row.dbhCm} cm`,
      detail: `冠幅 ${row.crownM} m，倾斜 ${row.leanDeg}°，空洞 ${row.hollowCount} 处，立地：${row.siteNote}`,
      badge: row.siteNote,
    })
  })
  measures.forEach((row) => {
    items.push({
      key: `measure-${row.id}`,
      kind: 'measure',
      date: row.date,
      title: `复壮措施 · ${row.type}`,
      detail: `材料：${row.material}；负责人：${row.operator}`,
      badge: row.state,
    })
  })
  supports.forEach((row) => {
    items.push({
      key: `support-${row.id}`,
      kind: 'support',
      date: row.installDate,
      title: `加固件 · ${row.type}`,
      detail: `安装于 ${row.installDate}，检查周期 ${row.checkCycleMon} 个月，最近检查 ${row.lastCheckDate || '未记录'}`,
      badge: row.type,
    })
  })
  reviews.forEach((row) => {
    items.push({
      key: `review-${row.id}`,
      kind: 'review',
      date: row.date,
      title: `长势复评 · ${row.vigor}`,
      detail: row.conclusion + (row.followUp === '' ? '' : `（后续措施：${row.followUp}）`),
      badge: row.trend,
    })
  })
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

export interface UseTreeHistoryResult {
  items: ComputedRef<HistoryItem[]>
  loading: Ref<boolean>
  error: Ref<string>
  countOf: (kind: HistoryKind) => number
}

/**
 * 订阅某棵古树的全部子记录并派生时间线。
 * treeId 为 null 时返回空时间线，调用方可据此渲染友好空态。
 */
export function useTreeHistory(treeId: Ref<string | null> | string | null): UseTreeHistoryResult {
  const idRef = computed<string | null>(() => (typeof treeId === 'string' || treeId === null ? treeId : treeId.value))

  const surveys = ref<Survey[]>([])
  const measures = ref<Measure[]>([])
  const supports = ref<Support[]>([])
  const reviews = ref<Review[]>([])
  const loading = ref(true)
  const error = ref('')

  void initDatabase()
  const subscription = liveQuery(async () => {
    await initDatabase()
    const [surveyRows, measureRows, supportRows, reviewRows] = await Promise.all([
      db.surveys.toArray(),
      db.measures.toArray(),
      db.supports.toArray(),
      db.reviews.toArray(),
    ])
    return { surveyRows, measureRows, supportRows, reviewRows }
  }).subscribe({
    next: ({ surveyRows, measureRows, supportRows, reviewRows }) => {
      surveys.value = surveyRows
      measures.value = measureRows
      supports.value = supportRows
      reviews.value = reviewRows
      loading.value = false
      error.value = ''
    },
    error: (err: unknown) => {
      error.value = err instanceof Error ? err.message : '读取古树历史失败'
      loading.value = false
    },
  })

  onScopeDispose(() => {
    subscription.unsubscribe()
  })

  const items = computed<HistoryItem[]>(() => {
    const id = idRef.value
    if (id === null || id === '') return []
    return buildHistory(
      surveys.value.filter((row) => row.treeId === id),
      measures.value.filter((row) => row.treeId === id),
      supports.value.filter((row) => row.treeId === id),
      reviews.value.filter((row) => row.treeId === id)
    )
  })

  const countOf = (kind: HistoryKind): number => items.value.filter((item) => item.kind === kind).length

  return { items, loading, error, countOf }
}
