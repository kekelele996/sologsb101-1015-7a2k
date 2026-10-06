<script setup lang="ts">
/**
 * /reviews 长势复评与结构版本
 * 复评增删改（衰弱 / 濒危强制填写后续措施）、古树历史时间线、JSON 导入导出与结构版本查看。
 * 消费模型：Review、Measure、全部模型；复用组件：<VigorTag>、<EmptyPanel>、<StatBadge>、<FilterBar>
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import VigorTag from '@/components/common/VigorTag.vue'
import { useIdbTable } from '@/hooks/useIdbTable'
import { HISTORY_KIND_LABEL, useTreeHistory } from '@/hooks/useTreeHistory'
import { useReviewStore } from '@/stores/reviewStore'
import { useTreeStore } from '@/stores/treeStore'
import { DB_NAME, DB_SCHEMA_VERSION, db, exportSnapshot, importSnapshot, resetDatabase } from '@/utils/db'
import { exportSnapshotJson, exportTreeCsvFile, parseSnapshot } from '@/utils/export'
import { TREND_OPTIONS, VIGOR_OPTIONS, VIGOR_NEED_FOLLOW_UP, type Review, type ReviewDraft, type Trend, type Vigor } from '@/types/review'

const router = useRouter()
const treeStore = useTreeStore()
const reviewStore = useReviewStore()

const { rows, loading, remove } = useIdbTable<Review>(db.reviews, { sortByUpdatedAt: false })

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const timelineTreeId = ref<string | null>(null)

const form = reactive<ReviewDraft>({
  treeId: '',
  date: '',
  vigor: '一般',
  trend: '持平',
  conclusion: '',
  followUp: '',
})

const needFollowUp = computed<boolean>(() => VIGOR_NEED_FOLLOW_UP.includes(form.vigor))

const rules = computed<FormRules<ReviewDraft>>(() => ({
  treeId: [{ required: true, message: '请选择古树', trigger: 'change' }],
  date: [{ required: true, message: '请选择复评日期', trigger: 'change' }],
  vigor: [{ required: true, message: '请选择长势', trigger: 'change' }],
  trend: [{ required: true, message: '请选择趋势', trigger: 'change' }],
  conclusion: [{ required: true, message: '请填写复评结论', trigger: 'blur' }],
  followUp: needFollowUp.value
    ? [{ required: true, message: '长势为衰弱 / 濒危时必须填写后续措施', trigger: 'blur' }]
    : [],
}))

const treeLabel = computed<Record<string, string>>(() =>
  Object.fromEntries(treeStore.trees.map((tree) => [tree.id, `${tree.code} ${tree.species}`]))
)

const filtered = computed<Review[]>(() => {
  const keyword = reviewStore.filters.keyword.trim().toLowerCase()
  return rows.value
    .filter((row) => {
      if (reviewStore.filters.treeId !== 'all' && row.treeId !== reviewStore.filters.treeId) return false
      if (reviewStore.filters.vigor !== 'all' && row.vigor !== reviewStore.filters.vigor) return false
      if (reviewStore.filters.trend !== 'all' && row.trend !== reviewStore.filters.trend) return false
      if (keyword === '') return true
      return (
        (treeLabel.value[row.treeId] ?? '').toLowerCase().includes(keyword) ||
        row.conclusion.toLowerCase().includes(keyword) ||
        row.followUp.toLowerCase().includes(keyword)
      )
    })
    .sort((a, b) => b.date.localeCompare(a.date))
})

const timelineTree = computed(() => treeStore.trees.find((tree) => tree.id === timelineTreeId.value) ?? null)
const { items: timelineItems } = useTreeHistory(timelineTreeId)

const weakCount = computed<number>(
  () => rows.value.filter((row) => VIGOR_NEED_FOLLOW_UP.includes(row.vigor)).length
)

onMounted(() => {
  void treeStore.loadAll()
  void reviewStore.init()
  timelineTreeId.value = treeStore.currentTreeId
})

function openCreate(): void {
  editingId.value = null
  Object.assign(form, {
    treeId:
      reviewStore.filters.treeId !== 'all'
        ? reviewStore.filters.treeId
        : (treeStore.currentTreeId ?? treeStore.trees[0]?.id ?? ''),
    date: new Date().toISOString().slice(0, 10),
    vigor: '一般' as Vigor,
    trend: '持平' as Trend,
    conclusion: '',
    followUp: '',
  })
  dialogVisible.value = true
}

function openEdit(row: Review): void {
  editingId.value = row.id
  Object.assign(form, {
    treeId: row.treeId,
    date: row.date,
    vigor: row.vigor,
    trend: row.trend,
    conclusion: row.conclusion,
    followUp: row.followUp,
  })
  dialogVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (formRef.value === undefined) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  const check = reviewStore.validate({ ...form })
  if (!check.ok) {
    ElMessage.error(check.message)
    return
  }
  submitting.value = true
  try {
    if (editingId.value === null) {
      const row = await reviewStore.createReview({ ...form })
      if (row !== null) ElMessage.success(`已登记 ${row.date} 的长势复评：${row.vigor}`)
    } else {
      const result = await reviewStore.updateReview(editingId.value, { ...form })
      if (!result.ok) {
        ElMessage.error(result.message)
        return
      }
      ElMessage.success('复评记录已更新')
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: Review): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除 ${row.date} 的长势复评记录（${row.vigor}）？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await remove(row.id)
  await reviewStore.deleteReview(row.id)
  ElMessage.success('复评记录已删除')
}

async function handleExport(): Promise<void> {
  const snapshot = await exportSnapshot()
  const filename = exportSnapshotJson(snapshot)
  ElMessage.success(`已导出整库存档 ${filename}`)
}

function handleExportCsv(): void {
  const filename = exportTreeCsvFile(
    treeStore.trees,
    treeStore.surveys,
    treeStore.measures,
    treeStore.supports,
    treeStore.reviews
  )
  ElMessage.success(`已导出古树养护总览 ${filename}`)
}

async function handleImport(uploadFile: UploadFile): Promise<void> {
  const raw = uploadFile.raw
  if (raw === undefined) return
  const text = await raw.text()
  const result = parseSnapshot(text)
  if (!result.ok || result.snapshot === null) {
    ElMessage.error(result.message)
    return
  }
  await importSnapshot(result.snapshot)
  await treeStore.loadAll()
  ElMessage.success(`导入成功：${result.message}`)
}

function handleReset(): void {
  ElMessageBox.confirm(
    '全部古树档案、树体检查、复壮措施、加固件与长势复评都会被清空，并重新灌入演示数据。',
    '确认重置本地数据？',
    { type: 'warning', confirmButtonText: '确认重置', cancelButtonText: '取消' }
  )
    .then(async () => {
      await resetDatabase()
      await treeStore.loadAll()
      ElMessage.success('已重置为演示数据')
    })
    .catch(() => undefined)
}

function handleFilterChange(key: string, value: string): void {
  if (key === 'treeId') reviewStore.setFilters({ treeId: value })
  if (key === 'vigor') reviewStore.setFilters({ vigor: value as Vigor | 'all' })
  if (key === 'trend') reviewStore.setFilters({ trend: value as Trend | 'all' })
}
</script>

<template>
  <div>
    <div class="stat-row">
      <StatBadge label="复评记录" :value="rows.length" suffix="次" tone="primary" icon="Histogram" />
      <StatBadge label="长势旺盛" :value="reviewStore.vigorStats['旺盛']" suffix="次" tone="success" icon="DataLine" />
      <StatBadge label="长势一般" :value="reviewStore.vigorStats['一般']" suffix="次" tone="info" icon="DataLine" />
      <StatBadge label="长势衰弱" :value="reviewStore.vigorStats['衰弱']" suffix="次" tone="warning" icon="Warning" />
      <StatBadge label="长势濒危" :value="reviewStore.vigorStats['濒危']" suffix="次" tone="danger" icon="Warning" />
      <StatBadge
        label="衰弱/濒危占比"
        :value="rows.length === 0 ? '0%' : `${Math.round((weakCount / rows.length) * 1000) / 10}%`"
        :percent="rows.length === 0 ? 0 : (weakCount / rows.length) * 100"
        tone="danger"
        icon="PieChart"
      />
      <StatBadge
        label="后续措施待补"
        :value="reviewStore.followUpMissing"
        suffix="株"
        :tone="reviewStore.followUpMissing > 0 ? 'danger' : 'success'"
        icon="Warning"
        hint="最新长势为衰弱 / 濒危但未填写后续措施的古树数量"
      />
      <StatBadge
        label="数据结构版本"
        :value="`v${DB_SCHEMA_VERSION}`"
        :suffix="`· ${DB_NAME}`"
        tone="info"
        icon="TrendCharts"
        hint="IndexedDB 库名与结构版本号；升级时会按 version().stores() 自动迁移"
      />
    </div>

    <el-alert
      v-if="reviewStore.followUpMissing > 0"
      type="error"
      show-icon
      :closable="false"
      class="mb-14"
      :title="`有 ${reviewStore.followUpMissing} 株古树的最新复评为衰弱 / 濒危但未填写后续措施`"
      description="请到复评列表中补充后续措施（换土、透气、树洞修补、加固等），否则无法通过复评校验。"
    />

    <el-row :gutter="14">
      <el-col :xs="24" :lg="17">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span class="card-header__title">长势复评与结构版本</span>
              <el-space wrap>
                <el-button @click="handleExport">
                  <el-icon><Download /></el-icon>
                  <span>导出 JSON 存档</span>
                </el-button>
                <el-button @click="handleExportCsv">
                  <el-icon><Download /></el-icon>
                  <span>导出 CSV 汇总</span>
                </el-button>
                <el-upload
                  :auto-upload="false"
                  :show-file-list="false"
                  accept=".json"
                  :on-change="handleImport"
                >
                  <el-button>
                    <el-icon><Upload /></el-icon>
                    <span>导入 JSON 存档</span>
                  </el-button>
                </el-upload>
                <el-button type="danger" plain @click="handleReset">重置演示数据</el-button>
                <el-button type="primary" @click="openCreate" :disabled="treeStore.trees.length === 0">
                  <el-icon><Plus /></el-icon>
                  <span>新增复评</span>
                </el-button>
              </el-space>
            </div>
          </template>

          <FilterBar
            :keyword="reviewStore.filters.keyword"
            :fields="[
              {
                key: 'treeId',
                label: '古树',
                options: treeStore.trees.map((tree) => tree.id),
                optionLabels: treeLabel,
              },
              { key: 'vigor', label: '长势', options: VIGOR_OPTIONS as unknown as string[] },
              { key: 'trend', label: '趋势', options: TREND_OPTIONS as unknown as string[] },
            ]"
            :values="{
              treeId: reviewStore.filters.treeId,
              vigor: reviewStore.filters.vigor,
              trend: reviewStore.filters.trend,
            }"
            :result-text="`命中 ${filtered.length} / ${rows.length} 条`"
            @update:keyword="(value: string) => reviewStore.setFilters({ keyword: value })"
            @change="handleFilterChange"
            @reset="reviewStore.resetFilters()"
          />

          <EmptyPanel
            v-if="rows.length === 0 && !loading"
            title="还没有长势复评记录"
            description="按次登记长势（旺盛 / 一般 / 衰弱 / 濒危）与趋势，衰弱或濒危时必须填写后续措施。"
            action-text="新增第一条复评"
            @action="openCreate"
          />

          <el-table
            v-else
            v-loading="loading || !treeStore.ready"
            :data="filtered"
            row-key="id"
            stripe
            @row-click="(row: Review) => (timelineTreeId = row.treeId)"
          >
            <el-table-column label="古树" min-width="180">
              <template #default="{ row }">
                <div class="cell-stack">
                  <el-link type="primary" @click.stop="router.push(`/trees/${row.treeId}/surveys`)">
                    {{ treeLabel[row.treeId] ?? '（古树已删除）' }}
                  </el-link>
                  <span class="cell-sub">最近复壮：{{ treeStore.trees.find((tree) => tree.id === row.treeId)?.lastMeasureDate || '未登记' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="date" label="复评日期" width="120" />
            <el-table-column label="长势" width="160">
              <template #default="{ row }">
                <VigorTag :vigor="row.vigor" :trend="row.trend" />
              </template>
            </el-table-column>
            <el-table-column label="趋势" width="100">
              <template #default="{ row }">
                <el-tag :type="row.trend === '好转' ? 'success' : row.trend === '下降' ? 'danger' : 'info'" size="small">
                  {{ row.trend }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="复评结论" min-width="240">
              <template #default="{ row }">
                <span>{{ row.conclusion }}</span>
              </template>
            </el-table-column>
            <el-table-column label="后续措施" min-width="240">
              <template #default="{ row }">
                <el-tag v-if="row.followUp === ''" type="info" size="small" effect="plain">无需填写</el-tag>
                <span v-else>{{ row.followUp }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click.stop="openEdit(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click.stop="handleDelete(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="7">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span class="card-header__title">古树历史时间线</span>
              <el-select
                :model-value="timelineTreeId ?? ''"
                placeholder="选择古树"
                size="small"
                style="width: 160px"
                @update:model-value="(value: string) => (timelineTreeId = value)"
              >
                <el-option
                  v-for="tree in treeStore.trees"
                  :key="tree.id"
                  :value="tree.id"
                  :label="`${tree.code} ${tree.species}`"
                />
              </el-select>
            </div>
          </template>
          <p v-if="timelineTree" class="timeline-sub">
            {{ timelineTree.location }} · 管护单位 {{ timelineTree.owner }}
          </p>
          <el-timeline v-if="timelineItems.length > 0">
            <el-timeline-item
              v-for="item in timelineItems"
              :key="item.key"
              :timestamp="`${item.date} · ${HISTORY_KIND_LABEL[item.kind]}`"
              placement="top"
            >
              <div class="timeline-title">{{ item.title }}</div>
              <div class="timeline-detail">{{ item.detail }}</div>
              <el-tag size="small" effect="plain">{{ item.badge }}</el-tag>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无历史记录" />
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增长势复评' : '编辑长势复评'" width="640px">
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
          <el-col :span="8">
            <el-form-item label="复评日期" prop="date">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="长势" prop="vigor">
              <el-select v-model="form.vigor" style="width: 100%">
                <el-option v-for="item in VIGOR_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="趋势" prop="trend">
              <el-select v-model="form.trend" style="width: 100%">
                <el-option v-for="item in TREND_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="复评结论" prop="conclusion">
          <el-input v-model="form.conclusion" type="textarea" :rows="2" placeholder="如：树冠外围枝条略有回枯，整体长势中等偏下。" />
        </el-form-item>
        <el-form-item label="后续措施" prop="followUp">
          <el-input
            v-model="form.followUp"
            type="textarea"
            :rows="2"
            :placeholder="needFollowUp ? '长势为衰弱 / 濒危，必填：如 2026 年秋季安排树洞修补与树盘透气改造' : '可选：填写下一步养护安排'"
          />
        </el-form-item>
        <el-alert
          :type="needFollowUp ? 'error' : 'info'"
          show-icon
          :closable="false"
          :title="needFollowUp ? `长势为「${form.vigor}」，后续措施为必填项` : '长势良好，后续措施为选填项'"
          description="长势为衰弱或濒危时，必须填写后续措施才能保存，否则复评校验会拦截。"
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

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-sub {
  font-size: 12px;
  color: #8c8479;
}

.timeline-sub {
  margin: 0 0 12px;
  font-size: 12px;
  color: #8c8479;
}

.timeline-title {
  font-size: 13px;
  font-weight: 600;
  color: #2f2a24;
}

.timeline-detail {
  margin: 4px 0 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #8c8479;
}

.mb-14 {
  margin-bottom: 14px;
}
</style>
