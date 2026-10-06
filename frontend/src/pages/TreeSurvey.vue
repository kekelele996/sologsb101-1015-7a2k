<script setup lang="ts">
/**
 * /trees/:id/surveys 树体与立地检查
 * 录树高 / 胸径 / 冠幅 / 倾斜 / 空洞并对比上次，展示古树历史时间线。
 * 消费模型：Survey、Tree；复用组件：<StatBadge>、<EmptyPanel>
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useIdbTable } from '@/hooks/useIdbTable'
import { HISTORY_KIND_LABEL, useTreeHistory } from '@/hooks/useTreeHistory'
import { useTreeStore } from '@/stores/treeStore'
import { db } from '@/utils/db'
import { SITE_NOTE_OPTIONS, type SiteNote, type Survey, type SurveyDraft } from '@/types/survey'
import { LEAN_DANGER_DEG, LEAN_WATCH_DEG, annualGrowth, hollowRisk, leanLevel, siteAdvice } from '@/utils/dimension'

const route = useRoute()
const router = useRouter()
const treeStore = useTreeStore()

const treeId = computed<string>(() => String(route.params.id ?? ''))
const tree = computed(() => treeStore.trees.find((item) => item.id === treeId.value) ?? null)
const { rows, loading, create, update, remove } = useIdbTable<Survey>(db.surveys, { sortByUpdatedAt: false })
const { items } = useTreeHistory(treeId)

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<SurveyDraft>({
  treeId: '',
  date: '',
  heightM: 12,
  dbhCm: 60,
  crownM: 8,
  leanDeg: 2,
  hollowCount: 0,
  siteNote: '裸土',
})

const rules: FormRules<SurveyDraft> = {
  date: [{ required: true, message: '请选择检查日期', trigger: 'change' }],
  heightM: [{ required: true, message: '请填写树高', trigger: 'blur' }],
  dbhCm: [{ required: true, message: '请填写胸径', trigger: 'blur' }],
  crownM: [{ required: true, message: '请填写冠幅', trigger: 'blur' }],
  leanDeg: [{ required: true, message: '请填写倾斜度', trigger: 'blur' }],
  hollowCount: [{ required: true, message: '请填写空洞数', trigger: 'blur' }],
  siteNote: [{ required: true, message: '请选择立地状况', trigger: 'change' }],
}

/** 该株古树的检查记录，按日期升序 */
const surveys = computed<Survey[]>(() =>
  rows.value
    .filter((row) => row.treeId === treeId.value)
    .sort((a, b) => a.date.localeCompare(b.date))
)

/** 表格展示顺序：日期倒序 */
const displayRows = computed<Survey[]>(() => [...surveys.value].reverse())

function previousOf(row: Survey): Survey | null {
  const index = surveys.value.findIndex((item) => item.id === row.id)
  return index > 0 ? surveys.value[index - 1] : null
}

function deltaText(previous: number | null, current: number, unit: string): string {
  if (previous === null) return '首次检查'
  const delta = Math.round((current - previous) * 100) / 100
  if (delta === 0) return `持平 ${unit}`
  return `${delta > 0 ? '+' : ''}${delta} ${unit}`
}

const latest = computed<Survey | null>(() =>
  surveys.value.length === 0 ? null : surveys.value[surveys.value.length - 1]
)

const annual = computed(() => {
  if (surveys.value.length < 2) return { height: 0, dbh: 0, crown: 0 }
  const current = surveys.value[surveys.value.length - 1]
  const previous = surveys.value[surveys.value.length - 2]
  return {
    height: annualGrowth(previous.heightM, current.heightM, previous.date, current.date),
    dbh: annualGrowth(previous.dbhCm, current.dbhCm, previous.date, current.date),
    crown: annualGrowth(previous.crownM, current.crownM, previous.date, current.date),
  }
})

const risk = computed(() => (latest.value === null ? null : hollowRisk(latest.value.hollowCount)))

onMounted(() => {
  void treeStore.loadAll()
})

function openCreate(): void {
  editingId.value = null
  Object.assign(form, {
    treeId: treeId.value,
    date: new Date().toISOString().slice(0, 10),
    heightM: latest.value === null ? 12 : latest.value.heightM,
    dbhCm: latest.value === null ? 60 : latest.value.dbhCm,
    crownM: latest.value === null ? 8 : latest.value.crownM,
    leanDeg: latest.value === null ? 2 : latest.value.leanDeg,
    hollowCount: latest.value === null ? 0 : latest.value.hollowCount,
    siteNote: latest.value === null ? ('裸土' as SiteNote) : latest.value.siteNote,
  })
  dialogVisible.value = true
}

function openEdit(row: Survey): void {
  editingId.value = row.id
  Object.assign(form, {
    treeId: row.treeId,
    date: row.date,
    heightM: row.heightM,
    dbhCm: row.dbhCm,
    crownM: row.crownM,
    leanDeg: row.leanDeg,
    hollowCount: row.hollowCount,
    siteNote: row.siteNote,
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
      await create({ ...form }, 'survey')
      ElMessage.success('树体检查记录已登记')
    } else {
      await update(editingId.value, { ...form })
      ElMessage.success('检查记录已更新')
    }
    if (leanLevel(form.leanDeg) === 'danger') {
      ElMessage({
        type: 'warning',
        message: `倾斜度 ${form.leanDeg}° 超过 ${LEAN_DANGER_DEG}° 警戒线，建议安排支撑加固`,
        duration: 6000,
      })
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: Survey): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除 ${row.date} 的检查记录？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await remove(row.id)
  ElMessage.success('检查记录已删除')
}
</script>

<template>
  <div>
    <el-page-header :content="tree === null ? '树体检查' : `${tree.code} · ${tree.species}`" @back="router.push('/trees')">
      <template #extra>
        <el-space>
          <el-tag v-if="tree" :type="tree.protectLevel === '一级' ? 'danger' : tree.protectLevel === '二级' ? 'warning' : 'info'">
            {{ tree.protectLevel }}
          </el-tag>
          <el-tag v-if="tree" type="info">约 {{ tree.ageYears }} 年</el-tag>
        </el-space>
      </template>
    </el-page-header>

    <EmptyPanel
      v-if="treeStore.ready && tree === null"
      title="古树档案不存在或已被删除"
      :description="`未能找到 id 为「${treeId}」的古树档案，可能是链接已过期，或该档案已被删除。`"
      action-text="返回古树档案列表"
      class="mt-14"
      @action="router.push('/trees')"
    >
      <template #extra>
        <el-button @click="router.push('/trees')">返回</el-button>
      </template>
    </EmptyPanel>

    <template v-else>
      <div class="stat-row">
        <StatBadge label="检查次数" :value="surveys.length" suffix="次" tone="primary" icon="Histogram" />
        <StatBadge
          label="最新树高"
          :value="latest === null ? '—' : latest.heightM"
          suffix="m"
          tone="info"
          icon="DataLine"
        />
        <StatBadge
          label="最新胸径"
          :value="latest === null ? '—' : latest.dbhCm"
          suffix="cm"
          tone="success"
          icon="TrendCharts"
        />
        <StatBadge
          label="树高年生长量"
          :value="annual.height"
          suffix="m/年"
          tone="primary"
          icon="TrendCharts"
          hint="由最近两次检查的树高差按天数年化"
        />
        <StatBadge
          label="胸径年生长量"
          :value="annual.dbh"
          suffix="cm/年"
          tone="success"
          icon="TrendCharts"
        />
        <StatBadge
          label="空洞风险"
          :value="latest === null ? '—' : latest.hollowCount"
          suffix="处"
          :tone="risk === null ? 'default' : risk.level === 'danger' ? 'danger' : risk.level === 'watch' ? 'warning' : 'success'"
          icon="Warning"
          :hint="risk === null ? '暂无检查记录' : risk.message"
        />
      </div>

      <el-alert
        v-if="risk !== null && risk.level !== 'safe'"
        :type="risk.level === 'danger' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        class="mb-14"
        :title="risk.message"
        :description="latest === null ? '' : siteAdvice(latest.siteNote)"
      />
      <el-alert
        v-else-if="latest !== null && leanLevel(latest.leanDeg) !== 'safe'"
        :type="leanLevel(latest.leanDeg) === 'danger' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        class="mb-14"
        :title="`倾斜度 ${latest.leanDeg}°，超过 ${leanLevel(latest.leanDeg) === 'danger' ? LEAN_DANGER_DEG : LEAN_WATCH_DEG}° 阈值`"
        :description="siteAdvice(latest.siteNote)"
      />

      <el-row :gutter="14">
        <el-col :xs="24" :lg="16">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span class="card-header__title">树体与立地检查记录</span>
                <el-button type="primary" @click="openCreate">
                  <el-icon><Plus /></el-icon>
                  <span>新增检查</span>
                </el-button>
              </div>
            </template>

            <EmptyPanel
              v-if="surveys.length === 0 && !loading"
              title="该古树还没有检查记录"
              description="录入树高、胸径、冠幅、倾斜度、空洞数与立地状况，系统会自动与上次检查对比并计算年生长量。"
              action-text="新增第一次检查"
              @action="openCreate"
            />

            <el-table v-else v-loading="loading" :data="displayRows" row-key="id" stripe>
              <el-table-column prop="date" label="检查日期" width="120" />
              <el-table-column label="树高(m)" width="150">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>{{ row.heightM }}</span>
                    <span class="cell-sub">{{ deltaText(previousOf(row)?.heightM ?? null, row.heightM, 'm') }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="胸径(cm)" width="150">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>{{ row.dbhCm }}</span>
                    <span class="cell-sub">{{ deltaText(previousOf(row)?.dbhCm ?? null, row.dbhCm, 'cm') }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="冠幅(m)" width="140">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>{{ row.crownM }}</span>
                    <span class="cell-sub">{{ deltaText(previousOf(row)?.crownM ?? null, row.crownM, 'm') }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="倾斜度" width="130">
                <template #default="{ row }">
                  <el-tag
                    size="small"
                    :type="leanLevel(row.leanDeg) === 'danger' ? 'danger' : leanLevel(row.leanDeg) === 'watch' ? 'warning' : 'success'"
                  >
                    {{ row.leanDeg }}°
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="空洞" width="90" align="right">
                <template #default="{ row }">{{ row.hollowCount }} 处</template>
              </el-table-column>
              <el-table-column label="立地状况" width="110">
                <template #default="{ row }">
                  <el-tag size="small" type="info">{{ row.siteNote }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="140" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                  <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-col>

        <el-col :xs="24" :lg="8">
          <el-card shadow="never">
            <template #header>
              <span class="card-header__title">古树历史时间线</span>
            </template>
            <el-timeline v-if="items.length > 0">
              <el-timeline-item
                v-for="item in items"
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
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增树体检查' : '编辑树体检查'" width="660px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="检查日期" prop="date">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="立地状况" prop="siteNote">
              <el-select v-model="form.siteNote" style="width: 100%">
                <el-option v-for="item in SITE_NOTE_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="树高（m）" prop="heightM">
              <el-input-number v-model="form.heightM" :min="0.1" :max="120" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="胸径（cm）" prop="dbhCm">
              <el-input-number v-model="form.dbhCm" :min="1" :max="600" :step="0.5" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="冠幅（m）" prop="crownM">
              <el-input-number v-model="form.crownM" :min="0.1" :max="80" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="倾斜度（°）" prop="leanDeg">
              <el-input-number v-model="form.leanDeg" :min="0" :max="90" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空洞数（处）" prop="hollowCount">
              <el-input-number v-model="form.hollowCount" :min="0" :max="99" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-alert
          :type="leanLevel(form.leanDeg) === 'danger' ? 'error' : leanLevel(form.leanDeg) === 'watch' ? 'warning' : 'success'"
          show-icon
          :closable="false"
          :title="`当前倾斜度判定：${leanLevel(form.leanDeg) === 'danger' ? '超限' : leanLevel(form.leanDeg) === 'watch' ? '需关注' : '正常'}`"
          :description="`安全阈值：< ${LEAN_WATCH_DEG}° 正常；${LEAN_WATCH_DEG}–${LEAN_DANGER_DEG}° 需关注；> ${LEAN_DANGER_DEG}° 超限。${siteAdvice(form.siteNote)}`"
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
  margin: 14px 0;
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

.mt-14 {
  margin-top: 14px;
}

.mb-14 {
  margin-bottom: 14px;
}
</style>
