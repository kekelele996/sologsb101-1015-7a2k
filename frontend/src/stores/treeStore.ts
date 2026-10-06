/**
 * 古树档案状态管理（Pinia）
 * 维护古树列表、当前选中古树、筛选条件与古树级派生统计；
 * 通过 Dexie liveQuery 订阅全量数据，写操作落库后自动回灌。
 */
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { liveQuery } from 'dexie'
import type { ProtectLevel, Tree, TreeDraft } from '../types/tree'
import type { Survey } from '../types/survey'
import type { Measure } from '../types/measure'
import type { Support } from '../types/support'
import type { Review, Trend, Vigor } from '../types/review'
import { VIGOR_NEED_FOLLOW_UP } from '../types/review'
import {
  DB_SCHEMA_VERSION,
  ROW_REVISION,
  countAll,
  db,
  initDatabase,
  putTree,
  removeTree,
} from '../utils/db'
import { nowIso, uuid } from '../utils/id'
import {
  LEAN_LEVEL_LABEL,
  annualGrowth,
  isSupportOverdue,
  leanLevel,
  type LeanLevel,
} from '../utils/dimension'

/** 古树筛选条件（关键字 + 保护级别 + 树种），由 <FilterBar> 同步到 URL query */
export interface TreeFilters {
  keyword: string
  protectLevel: ProtectLevel | 'all'
  species: string | 'all'
}

/** 单株古树的派生统计，供档案页、检查页、加固页与复评页复用 */
export interface TreeStat {
  treeId: string
  surveyCount: number
  latestSurvey: Survey | null
  /** 树高年生长量（米/年） */
  heightAnnual: number
  /** 胸径年生长量（厘米/年） */
  dbhAnnual: number
  /** 倾斜安全等级 */
  lean: LeanLevel
  leanLabel: string
  /** 最新空洞数 */
  hollowCount: number
  measureCount: number
  doneMeasureCount: number
  pendingMeasureCount: number
  supportCount: number
  /** 超周期未检查的加固件数 */
  overdueCount: number
  reviewCount: number
  latestVigor: Vigor | null
  latestTrend: Trend | null
  /** 是否需要填写后续措施（最新长势为衰弱 / 濒危） */
  needFollowUp: boolean
}

const CURRENT_TREE_KEY = 'gbheritagetree:currentTreeId'

function readCurrentTreeId(): string | null {
  try {
    const raw = window.localStorage.getItem(CURRENT_TREE_KEY)
    return raw === null || raw === '' ? null : raw
  } catch {
    return null
  }
}

function writeCurrentTreeId(id: string | null): void {
  try {
    window.localStorage.setItem(CURRENT_TREE_KEY, id ?? '')
  } catch {
    /* 隐私模式下写入失败时静默降级 */
  }
}

const EMPTY_STAT: Omit<TreeStat, 'treeId'> = {
  surveyCount: 0,
  latestSurvey: null,
  heightAnnual: 0,
  dbhAnnual: 0,
  lean: 'safe',
  leanLabel: LEAN_LEVEL_LABEL.safe,
  hollowCount: 0,
  measureCount: 0,
  doneMeasureCount: 0,
  pendingMeasureCount: 0,
  supportCount: 0,
  overdueCount: 0,
  reviewCount: 0,
  latestVigor: null,
  latestTrend: null,
  needFollowUp: false,
}

let subscribed = false

export const useTreeStore = defineStore('tree', () => {
  const trees = ref<Tree[]>([])
  const surveys = ref<Survey[]>([])
  const measures = ref<Measure[]>([])
  const supports = ref<Support[]>([])
  const reviews = ref<Review[]>([])
  const loading = ref(true)
  const ready = ref(false)
  const error = ref('')
  const currentTreeId = ref<string | null>(readCurrentTreeId())
  const counts = ref<Record<string, number>>({})
  const filters = reactive<TreeFilters>({ keyword: '', protectLevel: 'all', species: 'all' })

  const speciesOptions = computed<string[]>(() => {
    const set = new Set(trees.value.map((tree) => tree.species))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  })

  const stats = computed<Record<string, TreeStat>>(() => {
    const result: Record<string, TreeStat> = {}
    trees.value.forEach((tree) => {
      const treeSurveys = surveys.value
        .filter((row) => row.treeId === tree.id)
        .sort((a, b) => a.date.localeCompare(b.date))
      const latest = treeSurveys.length > 0 ? treeSurveys[treeSurveys.length - 1] : null
      const previous = treeSurveys.length > 1 ? treeSurveys[treeSurveys.length - 2] : null
      const treeMeasures = measures.value.filter((row) => row.treeId === tree.id)
      const treeSupports = supports.value.filter((row) => row.treeId === tree.id)
      const treeReviews = reviews.value
        .filter((row) => row.treeId === tree.id)
        .sort((a, b) => a.date.localeCompare(b.date))
      const latestReview = treeReviews.length > 0 ? treeReviews[treeReviews.length - 1] : null
      const lean = latest === null ? 'safe' : leanLevel(latest.leanDeg)
      result[tree.id] = {
        treeId: tree.id,
        surveyCount: treeSurveys.length,
        latestSurvey: latest,
        heightAnnual:
          latest !== null && previous !== null
            ? annualGrowth(previous.heightM, latest.heightM, previous.date, latest.date)
            : 0,
        dbhAnnual:
          latest !== null && previous !== null
            ? annualGrowth(previous.dbhCm, latest.dbhCm, previous.date, latest.date)
            : 0,
        lean,
        leanLabel: LEAN_LEVEL_LABEL[lean],
        hollowCount: latest === null ? 0 : latest.hollowCount,
        measureCount: treeMeasures.length,
        doneMeasureCount: treeMeasures.filter((row) => row.state === '已完成').length,
        pendingMeasureCount: treeMeasures.filter((row) => row.state !== '已完成').length,
        supportCount: treeSupports.length,
        overdueCount: treeSupports.filter((row) => isSupportOverdue(row.lastCheckDate, row.checkCycleMon)).length,
        reviewCount: treeReviews.length,
        latestVigor: latestReview === null ? null : latestReview.vigor,
        latestTrend: latestReview === null ? null : latestReview.trend,
        needFollowUp: latestReview !== null && VIGOR_NEED_FOLLOW_UP.includes(latestReview.vigor),
      }
    })
    return result
  })

  const visibleTrees = computed<Tree[]>(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return trees.value.filter((tree) => {
      if (filters.protectLevel !== 'all' && tree.protectLevel !== filters.protectLevel) return false
      if (filters.species !== 'all' && tree.species !== filters.species) return false
      if (keyword === '') return true
      return (
        tree.code.toLowerCase().includes(keyword) ||
        tree.species.toLowerCase().includes(keyword) ||
        tree.location.toLowerCase().includes(keyword) ||
        tree.owner.toLowerCase().includes(keyword)
      )
    })
  })

  const currentTree = computed<Tree | null>(
    () => trees.value.find((tree) => tree.id === currentTreeId.value) ?? null
  )

  const overdueSupports = computed<Support[]>(() =>
    supports.value.filter((row) => isSupportOverdue(row.lastCheckDate, row.checkCycleMon))
  )

  function statOf(treeId: string): TreeStat {
    return stats.value[treeId] ?? { treeId, ...EMPTY_STAT }
  }

  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      await initDatabase()
      if (!subscribed) {
        subscribed = true
        liveQuery(async () => {
          const [treeRows, surveyRows, measureRows, supportRows, reviewRows] = await Promise.all([
            db.trees.toArray(),
            db.surveys.toArray(),
            db.measures.toArray(),
            db.supports.toArray(),
            db.reviews.toArray(),
          ])
          return { treeRows, surveyRows, measureRows, supportRows, reviewRows }
        }).subscribe({
          next: ({ treeRows, surveyRows, measureRows, supportRows, reviewRows }) => {
            const sorted = [...treeRows].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
            trees.value = sorted
            surveys.value = surveyRows
            measures.value = measureRows
            supports.value = supportRows
            reviews.value = reviewRows
            loading.value = false
            ready.value = true
            error.value = ''
            const stillExists =
              currentTreeId.value !== null && sorted.some((tree) => tree.id === currentTreeId.value)
            if (!stillExists) {
              selectTree(sorted.length > 0 ? sorted[0].id : null)
            }
          },
          error: (err: unknown) => {
            error.value = err instanceof Error ? err.message : '读取古树数据失败'
            loading.value = false
          },
        })
      }
      await refreshCounts()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '初始化本地数据库失败'
      loading.value = false
    }
  }

  function selectTree(treeId: string | null): void {
    currentTreeId.value = treeId
    writeCurrentTreeId(treeId)
  }

  function setFilters(patch: Partial<TreeFilters>): void {
    Object.assign(filters, patch)
  }

  function resetFilters(): void {
    filters.keyword = ''
    filters.protectLevel = 'all'
    filters.species = 'all'
  }

  async function createTree(draft: TreeDraft): Promise<Tree> {
    const stamp = nowIso()
    const row: Tree = {
      id: uuid('tree'),
      code: draft.code.trim() || '未编号',
      species: draft.species.trim() || '未鉴定',
      protectLevel: draft.protectLevel,
      ageYears: draft.ageYears,
      location: draft.location.trim(),
      owner: draft.owner.trim(),
      lastMeasureDate: '',
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    }
    await putTree(row)
    selectTree(row.id)
    return row
  }

  async function updateTree(treeId: string, draft: TreeDraft): Promise<void> {
    const existing = await db.trees.get(treeId)
    if (!existing) return
    await putTree({
      ...existing,
      code: draft.code.trim() || existing.code,
      species: draft.species.trim() || existing.species,
      protectLevel: draft.protectLevel,
      ageYears: draft.ageYears,
      location: draft.location.trim(),
      owner: draft.owner.trim(),
    })
  }

  async function deleteTree(treeId: string): Promise<void> {
    await removeTree(treeId)
    if (currentTreeId.value === treeId) selectTree(null)
    await refreshCounts()
  }

  async function refreshCounts(): Promise<void> {
    const result = await countAll()
    counts.value = { ...result, schemaVersion: DB_SCHEMA_VERSION }
  }

  return {
    trees,
    surveys,
    measures,
    supports,
    reviews,
    loading,
    ready,
    error,
    counts,
    filters,
    currentTreeId,
    currentTree,
    speciesOptions,
    stats,
    visibleTrees,
    overdueSupports,
    statOf,
    loadAll,
    selectTree,
    setFilters,
    resetFilters,
    createTree,
    updateTree,
    deleteTree,
    refreshCounts,
  }
})
