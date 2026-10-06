/**
 * 复壮措施状态管理（Pinia）
 * 维护措施草稿、实施状态流转与批量操作；完成即回写古树最近复壮日期。
 */
import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Measure, MeasureDraft, MeasureState, MeasureType } from '../types/measure'
import {
  batchSetMeasureState,
  db,
  initDatabase,
  putMeasure,
  removeMeasure,
} from '../utils/db'
import { nowIso, uuid } from '../utils/id'
import { useTreeStore } from './treeStore'

/** 复壮措施筛选条件 */
export interface MeasureFilters {
  keyword: string
  treeId: string | 'all'
  type: MeasureType | 'all'
  state: MeasureState | 'all'
}

export const useMeasureStore = defineStore('measure', () => {
  const filters = reactive<MeasureFilters>({ keyword: '', treeId: 'all', type: 'all', state: 'all' })
  /** 每行的行内编辑草稿，key = measure id */
  const drafts = ref<Record<string, Partial<MeasureDraft>>>({})
  const selectedIds = ref<string[]>([])
  /** 批量操作选中的目标状态 */
  const stateDraft = ref<MeasureState>('已完成')
  const lastMessage = ref('')
  const revision = ref(0)

  async function init(): Promise<void> {
    await initDatabase()
    revision.value += 1
  }

  function setFilters(patch: Partial<MeasureFilters>): void {
    Object.assign(filters, patch)
  }

  function resetFilters(): void {
    filters.keyword = ''
    filters.treeId = 'all'
    filters.type = 'all'
    filters.state = 'all'
    selectedIds.value = []
  }

  function setSelectedIds(ids: string[]): void {
    selectedIds.value = [...ids]
  }

  function setStateDraft(state: MeasureState): void {
    stateDraft.value = state
  }

  function setDraft(measureId: string, patch: Partial<MeasureDraft>): void {
    drafts.value = { ...drafts.value, [measureId]: { ...drafts.value[measureId], ...patch } }
  }

  function clearDraft(measureId: string): void {
    const next = { ...drafts.value }
    delete next[measureId]
    drafts.value = next
  }

  function hasDraft(measureId: string): boolean {
    return drafts.value[measureId] !== undefined
  }

  async function saveDraft(measureId: string): Promise<void> {
    const draft = drafts.value[measureId]
    if (draft === undefined) return
    const existing = await db.measures.get(measureId)
    if (!existing) return
    await putMeasure({ ...existing, ...draft } as Measure)
    clearDraft(measureId)
    revision.value += 1
    lastMessage.value = '措施草稿已保存'
  }

  async function createMeasure(draft: MeasureDraft): Promise<Measure> {
    const stamp = nowIso()
    const row: Measure = {
      id: uuid('measure'),
      treeId: draft.treeId,
      type: draft.type,
      date: draft.date,
      material: draft.material.trim(),
      operator: draft.operator.trim(),
      state: draft.state,
      createdAt: stamp,
      updatedAt: stamp,
      revision: 2,
    }
    await putMeasure(row)
    revision.value += 1
    if (row.state === '已完成') {
      lastMessage.value = '措施已登记为「已完成」，古树最近复壮日期已回写'
    }
    return row
  }

  async function updateMeasure(measureId: string, draft: MeasureDraft): Promise<void> {
    const existing = await db.measures.get(measureId)
    if (!existing) return
    await putMeasure({
      ...existing,
      treeId: draft.treeId,
      type: draft.type,
      date: draft.date,
      material: draft.material.trim(),
      operator: draft.operator.trim(),
      state: draft.state,
    })
    revision.value += 1
  }

  async function deleteMeasure(measureId: string): Promise<void> {
    await removeMeasure(measureId)
    clearDraft(measureId)
    selectedIds.value = selectedIds.value.filter((id) => id !== measureId)
    revision.value += 1
  }

  /** 推进到下一状态：计划 → 实施中 → 已完成 */
  async function advance(measureId: string): Promise<MeasureState | null> {
    const existing = await db.measures.get(measureId)
    if (!existing) return null
    const flow: MeasureState[] = ['计划', '实施中', '已完成']
    const index = flow.indexOf(existing.state)
    if (index < 0 || index >= flow.length - 1) return null
    const next = flow[index + 1]
    await putMeasure({ ...existing, state: next })
    revision.value += 1
    lastMessage.value = next === '已完成' ? '措施已完成，古树最近复壮日期已回写' : `措施状态已推进为「${next}」`
    return next
  }

  /** 批量修改实施状态 */
  async function batchSetState(state: MeasureState): Promise<number> {
    const count = await batchSetMeasureState(selectedIds.value, state)
    selectedIds.value = []
    revision.value += 1
    lastMessage.value = `已把 ${count} 条措施状态改为「${state}」`
    // 回写古树日期后，同步刷新古树统计
    await useTreeStore().refreshCounts()
    return count
  }

  return {
    filters,
    drafts,
    selectedIds,
    stateDraft,
    lastMessage,
    revision,
    init,
    setFilters,
    resetFilters,
    setSelectedIds,
    setStateDraft,
    setDraft,
    clearDraft,
    hasDraft,
    saveDraft,
    createMeasure,
    updateMeasure,
    deleteMeasure,
    advance,
    batchSetState,
  }
})
