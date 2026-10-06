<script setup lang="ts">
/**
 * /measures 复壮措施台账
 * 新增 / 编辑 / 删除措施，按类型与实施状态筛选，支持行内草稿与批量改状态；
 * 每次措施变动后，古树最近复壮日期都按现存「已完成」措施的最晚实施日期重算。
 * 消费模型：Measure、Tree；复用组件：<FilterBar>、<EmptyPanel>、<StatBadge>
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useIdbTable } from '@/hooks/useIdbTable'
import { useMeasureStore } from '@/stores/measureStore'
import { useTreeStore } from '@/stores/treeStore'
import { db } from '@/utils/db'
import {
  MEASURE_STATE_OPTIONS,
  MEASURE_TYPE_OPTIONS,
  type Measure,
  type MeasureDraft,
  type MeasureState,
  type MeasureType,
} from '@/types/measure'

const treeStore = useTreeStore()
const measureStore = useMeasureStore()

const { rows, loading } = useIdbTable<Measure>(db.measures, { sortByUpdatedAt: false })

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<MeasureDraft>({
  treeId: '',
  type: '施肥',
  date: '',
  material: '',
  operator: '',
  state: '计划',
})

const rules: FormRules<MeasureDraft> = {
  treeId: [{ required: true, message: '请选择古树', trigger: 'change' }],
  type: [{ required: true, message: '请选择措施类型', trigger: 'change' }],
  date: [{ required: true, message: '请选择实施日期', trigger: 'change' }],
  material: [{ required: true, message: '请填写材料', trigger: 'blur' }],
  operator: [{ required: true, message: '请填写负责人', trigger: 'blur' }],
  state: [{ required: true, message: '请选择实施状态', trigger: 'change' }],
}

const treeLabel = computed<Record<string, string>>(() =>
  Object.fromEntries(treeStore.trees.map((tree) => [tree.id, `${tree.code} ${tree.species}`]))
)

const filtered = computed<Measure[]>(() => {
  const keyword = measureStore.filters.keyword.trim().toLowerCase()
  return rows.value
    .filter((row) => {
      if (measureStore.filters.treeId !== 'all' && row.treeId !== measureStore.filters.treeId) return false
      if (measureStore.filters.type !== 'all' && row.type !== measureStore.filters.type) return false
      if (measureStore.filters.state !== 'all' && row.state !== measureStore.filters.state) return false
      if (keyword === '') return true
      return (
        (treeLabel.value[row.treeId] ?? '').toLowerCase().includes(keyword) ||
        row.material.toLowerCase().includes(keyword) ||
        row.operator.toLowerCase().includes(keyword)
      )
    })
    .sort((a, b) => b.date.localeCompare(a.date))
})

const stats = computed(() => {
  const total = rows.value.length
  const done = rows.value.filter((row) => row.state === '已完成').length
  const pending = rows.value.filter((row) => row.state !== '已完成').length
  return { total, done, pending, donePct: total === 0 ? 0 : Math.round((done / total) * 1000) / 10 }
})

onMounted(() => {
  void treeStore.loadAll()
  void measureStore.init()
})

function openCreate(): void {
  const treeId =
    measureStore.filters.treeId !== 'all'
      ? measureStore.filters.treeId
      : (treeStore.currentTreeId ?? treeStore.trees[0]?.id ?? '')
  editingId.value = null
  Object.assign(form, {
    treeId,
    type: '施肥' as MeasureType,
    date: new Date().toISOString().slice(0, 10),
    material: '',
    operator: '',
    state: '计划' as MeasureState,
  })
  dialogVisible.value = true
}

function openEdit(row: Measure): void {
  editingId.value = row.id
  Object.assign(form, {
    treeId: row.treeId,
    type: row.type,
    date: row.date,
    material: row.material,
    operator: row.operator,
    state: row.state,
  })
  dialogVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (formRef.value === undefined) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value === null) {
      await measureStore.createMeasure({ ...form })
      ElMessage.success('复壮措施已登记')
    } else {
      await measureStore.updateMeasure(editingId.value, { ...form })
      ElMessage.success('复壮措施已更新')
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: Measure): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${row.type}」措施（${row.date}）？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await measureStore.deleteMeasure(row.id)
  ElMessage.success('措施已删除')
}

async function handleAdvance(row: Measure): Promise<void> {
  const next = await measureStore.advance(row.id)
  if (next === null) {
    ElMessage.info('该措施已处于「已完成」状态')
    return
  }
  ElMessage.success(`状态已推进为「${next}」`)
}

async function handleBatchState(): Promise<void> {
  if (measureStore.selectedIds.length === 0) {
    ElMessage.info('请先在列表中勾选需要调整的措施')
    return
  }
  const count = await measureStore.batchSetState(measureStore.stateDraft)
  ElMessage.success(`已把 ${count} 条措施状态改为「${measureStore.stateDraft}」`)
}

function handleFilterChange(key: string, value: string): void {
  if (key === 'treeId') measureStore.setFilters({ treeId: value })
  if (key === 'type') measureStore.setFilters({ type: value as MeasureType | 'all' })
  if (key === 'state') measureStore.setFilters({ state: value as MeasureState | 'all' })
}
</script>

<template>
  <div>
    <div class="stat-row">
      <StatBadge label="措施总数" :value="stats.total" suffix="项" tone="primary" icon="Histogram" />
      <StatBadge label="待办措施" :value="stats.pending" suffix="项" tone="warning" icon="Warning" />
      <StatBadge label="已完成" :value="stats.done" suffix="项" tone="success" icon="DataLine" />
      <StatBadge
        label="完成率"
        :value="`${stats.donePct}%`"
        :percent="stats.donePct"
        tone="primary"
        icon="PieChart"
      />
      <StatBadge label="筛选结果" :value="filtered.length" suffix="项" tone="info" icon="TrendCharts" size="small" />
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span class="card-header__title">复壮措施台账</span>
          <el-button type="primary" @click="openCreate" :disabled="treeStore.trees.length === 0">
            <el-icon><Plus /></el-icon>
            <span>新增复壮措施</span>
          </el-button>
        </div>
      </template>

      <FilterBar
        :keyword="measureStore.filters.keyword"
        :fields="[
          {
            key: 'treeId',
            label: '古树',
            options: treeStore.trees.map((tree) => tree.id),
            optionLabels: treeLabel,
          },
          { key: 'type', label: '措施类型', options: MEASURE_TYPE_OPTIONS as unknown as string[] },
          { key: 'state', label: '实施状态', options: MEASURE_STATE_OPTIONS as unknown as string[] },
        ]"
        :values="{
          treeId: measureStore.filters.treeId,
          type: measureStore.filters.type,
          state: measureStore.filters.state,
        }"
        :result-text="`命中 ${filtered.length} / ${rows.length} 项`"
        @update:keyword="(value: string) => measureStore.setFilters({ keyword: value })"
        @change="handleFilterChange"
        @reset="measureStore.resetFilters()"
      />

      <div class="batch-row">
        <el-tag :type="measureStore.selectedIds.length > 0 ? 'warning' : 'info'">
          已选 {{ measureStore.selectedIds.length }} 项
        </el-tag>
        <span class="batch-label">批量改为</span>
        <el-select
          :model-value="measureStore.stateDraft"
          style="width: 130px"
          @update:model-value="(value: string) => measureStore.setStateDraft(value as MeasureState)"
        >
          <el-option v-for="item in MEASURE_STATE_OPTIONS" :key="item" :value="item" :label="item" />
        </el-select>
        <el-button
          type="primary"
          plain
          :disabled="measureStore.selectedIds.length === 0"
          @click="handleBatchState"
        >
          批量调整实施状态
        </el-button>
        <el-button :disabled="measureStore.selectedIds.length === 0" @click="measureStore.setSelectedIds([])">
          取消选择
        </el-button>
        <el-tag v-if="measureStore.lastMessage" type="success" effect="plain">{{ measureStore.lastMessage }}</el-tag>
      </div>

      <EmptyPanel
        v-if="rows.length === 0 && !loading"
        title="还没有复壮措施"
        description="为古树登记换土、施肥、透气、树洞修补、病虫害防治等措施，并按「计划 → 实施中 → 已完成」跟踪实施。"
        action-text="新增第一条复壮措施"
        @action="openCreate"
      />

      <el-table
        v-else
        v-loading="loading || !treeStore.ready"
        :data="filtered"
        row-key="id"
        stripe
        @selection-change="(list: Measure[]) => measureStore.setSelectedIds(list.map((item) => item.id))"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column label="古树" min-width="180">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ treeLabel[row.treeId] ?? '（古树已删除）' }}</span>
              <span class="cell-sub">
                最近复壮：{{ treeStore.trees.find((tree) => tree.id === row.treeId)?.lastMeasureDate || '未登记' }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="措施类型" width="130">
          <template #default="{ row }">
            <el-tag type="success" effect="light">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="实施日期" width="180">
          <template #default="{ row }">
            <el-date-picker
              v-if="measureStore.hasDraft(row.id)"
              :model-value="measureStore.drafts[row.id]?.date ?? row.date"
              type="date"
              value-format="YYYY-MM-DD"
              size="small"
              style="width: 150px"
              @update:model-value="(value: string) => measureStore.setDraft(row.id, { date: value })"
            />
            <span v-else>{{ row.date }}</span>
          </template>
        </el-table-column>
        <el-table-column label="材料" min-width="220">
          <template #default="{ row }">
            <el-input
              v-if="measureStore.hasDraft(row.id)"
              :model-value="measureStore.drafts[row.id]?.material ?? row.material"
              size="small"
              @update:model-value="(value: string) => measureStore.setDraft(row.id, { material: value })"
            />
            <span v-else>{{ row.material }}</span>
          </template>
        </el-table-column>
        <el-table-column label="负责人" width="150">
          <template #default="{ row }">
            <el-input
              v-if="measureStore.hasDraft(row.id)"
              :model-value="measureStore.drafts[row.id]?.operator ?? row.operator"
              size="small"
              @update:model-value="(value: string) => measureStore.setDraft(row.id, { operator: value })"
            />
            <span v-else>{{ row.operator }}</span>
          </template>
        </el-table-column>
        <el-table-column label="实施状态" width="120">
          <template #default="{ row }">
            <el-tag
              :type="row.state === '已完成' ? 'success' : row.state === '实施中' ? 'warning' : 'info'"
              effect="dark"
            >
              {{ row.state }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="草稿" width="150">
          <template #default="{ row }">
            <el-button v-if="measureStore.hasDraft(row.id)" size="small" type="primary" @click="measureStore.saveDraft(row.id)">
              保存
            </el-button>
            <el-button v-if="measureStore.hasDraft(row.id)" size="small" @click="measureStore.clearDraft(row.id)">
              放弃
            </el-button>
            <el-button
              v-else
              size="small"
              @click="
                measureStore.setDraft(row.id, {
                  date: row.date,
                  material: row.material,
                  operator: row.operator,
                  state: row.state,
                })
              "
            >
              改草稿
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="row.state === '已完成'" @click="handleAdvance(row)">
              推进状态
            </el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增复壮措施' : '编辑复壮措施'" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="古树" prop="treeId">
          <el-select v-model="form.treeId" filterable style="width: 100%">
            <el-option
              v-for="tree in treeStore.trees"
              :key="tree.id"
              :value="tree.id"
              :label="`${tree.code} · ${tree.species} · ${tree.location}`"
            />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="措施类型" prop="type">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="item in MEASURE_TYPE_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="实施日期" prop="date">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="材料" prop="material">
          <el-input v-model="form.material" type="textarea" :rows="2" placeholder="如：基质土 6 m³ + 草炭土 2 m³" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="负责人" prop="operator">
              <el-input v-model="form.operator" placeholder="如：王建军" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="实施状态" prop="state">
              <el-select v-model="form.state" style="width: 100%">
                <el-option v-for="item in MEASURE_STATE_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="古树的最近复壮日期始终按本株现存「已完成」措施的最晚实施日期重算：措施退回实施中 / 计划或被删除后会自动回退，无已完成措施时显示未登记。"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.card-header__title {
  font-size: 15px;
  font-weight: 600;
  color: #2f2a24;
}

.batch-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.batch-label {
  font-size: 13px;
  color: #6b6257;
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-sub {
  font-size: 12px;
  color: #8c8479;
}
</style>
