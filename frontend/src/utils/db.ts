/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名：gbheritagetree
 * - 含数据结构版本号与 v1 → v2 → v3 升级迁移逻辑（升级时按 version().stores() 补齐索引）
 * - 提供各表增删改查、整库快照导入导出与重置
 * - 古树「最近复壮日期」为派生当前值：每次措施增删改后按该树现存「已完成」措施重算
 * 纯前端应用：不依赖任何后端服务或外部接口。
 */
import Dexie, { type Table } from 'dexie'
import type { Tree } from '../types/tree'
import type { Survey } from '../types/survey'
import type { Measure, MeasureState } from '../types/measure'
import type { Support } from '../types/support'
import type { Review } from '../types/review'
import { nowIso, today } from './id'
import { seedDatabase } from './seed'

/** 数据库名 */
export const DB_NAME = 'gbheritagetree'

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 3

/** 数据行结构修订号 */
export const ROW_REVISION = 2

class HeritageTreeDatabase extends Dexie {
  trees!: Table<Tree, string>
  surveys!: Table<Survey, string>
  measures!: Table<Measure, string>
  supports!: Table<Support, string>
  reviews!: Table<Review, string>

  constructor() {
    super(DB_NAME)

    // ---------- v1：初版结构 ----------
    this.version(1).stores({
      trees: 'id, code, species, protectLevel, ageYears, createdAt',
      surveys: 'id, treeId, date',
      measures: 'id, treeId, type, state, date',
      supports: 'id, treeId, type, installDate',
      reviews: 'id, treeId, date, vigor',
    })

    // ---------- v2：补齐索引与回写字段，并迁移历史数据 ----------
    this.version(DB_SCHEMA_VERSION)
      .stores({
        trees: 'id, code, species, protectLevel, ageYears, createdAt, updatedAt, owner',
        // 复合索引 [treeId+date]：按古树 + 日期快速取检查记录
        surveys: 'id, treeId, [treeId+date], date, siteNote',
        measures: 'id, treeId, type, state, date, operator',
        supports: 'id, treeId, type, installDate, lastCheckDate',
        reviews: 'id, treeId, date, vigor, trend',
      })
      .upgrade(async (tx) => {
        // 迁移 1：补齐 revision / createdAt / updatedAt
        const tables = [
          tx.table('trees'),
          tx.table('surveys'),
          tx.table('measures'),
          tx.table('supports'),
          tx.table('reviews'),
        ]
        for (const table of tables) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            row.revision = ROW_REVISION
            if (typeof row.createdAt !== 'string') row.createdAt = nowIso()
            if (typeof row.updatedAt !== 'string') row.updatedAt = row.createdAt
          })
        }
        // 迁移 2：古树补齐「最近复壮日期」
        await tx.table('trees').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.lastMeasureDate !== 'string') row.lastMeasureDate = ''
        })
        // 迁移 3：复评补齐「后续措施」
        await tx.table('reviews').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.followUp !== 'string') row.followUp = ''
        })
        // 迁移 4：加固件补齐「最近检查日期」
        await tx.table('supports').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.lastCheckDate !== 'string') row.lastCheckDate = ''
          if (typeof row.checkCycleMon !== 'number') row.checkCycleMon = 12
        })
      })

    // ---------- v3：修复「最近复壮日期」只增不退的历史脏数据 ----------
    // 索引结构不变，按各古树现存「已完成」措施重算 lastMeasureDate。
    this.version(3).upgrade(async (tx) => {
      const latest = new Map<string, string>()
      await tx.table('measures').toCollection().each((row: Measure) => {
        if (row.state !== '已完成') return
        const current = latest.get(row.treeId) ?? ''
        if (row.date > current) latest.set(row.treeId, row.date)
      })
      await tx.table('trees').toCollection().modify((row: Record<string, unknown>) => {
        row.lastMeasureDate = latest.get(row.id as string) ?? ''
      })
    })
  }
}

export const db = new HeritageTreeDatabase()

/* ------------------------------ 初始化与播种 ------------------------------ */

let initPromise: Promise<void> | null = null

/**
 * 打开数据库并在首屏自动播种演示数据（幂等：仅当主表为空时播种）。
 * 多次调用共用同一个 Promise，避免并发重复播种。
 */
export function initDatabase(): Promise<void> {
  if (initPromise === null) {
    initPromise = (async (): Promise<void> => {
      await db.open()
      // 首屏自动播种演示数据：仅当主表为空时执行（幂等）
      if ((await db.trees.count()) === 0) {
        await seedDatabase()
      }
    })()
  }
  return initPromise
}

/* -------------------------------- 古树 -------------------------------- */

export async function listTrees(): Promise<Tree[]> {
  const rows = await db.trees.toArray()
  return rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
}

export async function getTree(id: string): Promise<Tree | undefined> {
  return db.trees.get(id)
}

export async function putTree(row: Tree): Promise<void> {
  await db.trees.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION })
}

/** 删除古树并级联清理其检查、措施、加固与复评记录 */
export async function removeTree(id: string): Promise<void> {
  await db.transaction('rw', db.trees, db.surveys, db.measures, db.supports, db.reviews, async () => {
    await db.surveys.where('treeId').equals(id).delete()
    await db.measures.where('treeId').equals(id).delete()
    await db.supports.where('treeId').equals(id).delete()
    await db.reviews.where('treeId').equals(id).delete()
    await db.trees.delete(id)
  })
}

/* ------------------------------ 树体检查 ------------------------------ */

export async function listSurveys(): Promise<Survey[]> {
  const rows = await db.surveys.toArray()
  return rows.sort((a, b) => a.treeId.localeCompare(b.treeId) || a.date.localeCompare(b.date))
}

export async function listSurveysByTree(treeId: string): Promise<Survey[]> {
  const rows = await db.surveys.where('treeId').equals(treeId).toArray()
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export async function putSurvey(row: Survey): Promise<void> {
  await db.surveys.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION })
}

export async function removeSurvey(id: string): Promise<void> {
  await db.surveys.delete(id)
}

/* ------------------------------ 复壮措施 ------------------------------ */

export async function listMeasures(): Promise<Measure[]> {
  const rows = await db.measures.toArray()
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

export async function listMeasuresByTree(treeId: string): Promise<Measure[]> {
  const rows = await db.measures.where('treeId').equals(treeId).toArray()
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * 按某株古树现存「已完成」措施重算其最近复壮日期：
 * 取所有已完成措施中最新的实施日期；一条都没有时落回空串（页面显示「未登记」）。
 * 与现值相同则跳过写入——只改材料 / 负责人的编辑不会惊动古树行。
 * 同一天存在多条已完成措施时天然共存，重算结果仍是那一天，互不顶掉。
 */
export async function syncTreeLastMeasureDate(treeId: string): Promise<void> {
  const done = await db.measures
    .where('treeId')
    .equals(treeId)
    .filter((row) => row.state === '已完成')
    .toArray()
  const latest = done.reduce((acc, row) => (row.date > acc ? row.date : acc), '')
  const tree = await db.trees.get(treeId)
  if (!tree) return
  if (tree.lastMeasureDate === latest) return
  await db.trees.update(treeId, { lastMeasureDate: latest, updatedAt: nowIso() })
}

/**
 * 写入复壮措施。
 * 写入后按现存「已完成」措施重算所属古树的最近复壮日期；
 * 若本次编辑把措施改派到别的古树，新旧两株都会重算。
 */
export async function putMeasure(row: Measure): Promise<void> {
  await db.transaction('rw', db.trees, db.measures, async () => {
    const before = await db.measures.get(row.id)
    await db.measures.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION })
    const affected = new Set<string>([row.treeId])
    if (before && before.treeId !== row.treeId) affected.add(before.treeId)
    for (const treeId of affected) {
      await syncTreeLastMeasureDate(treeId)
    }
  })
}

/** 删除复壮措施，并按剩余「已完成」措施重算所属古树的最近复壮日期 */
export async function removeMeasure(id: string): Promise<void> {
  await db.transaction('rw', db.trees, db.measures, async () => {
    const before = await db.measures.get(id)
    await db.measures.delete(id)
    if (before) await syncTreeLastMeasureDate(before.treeId)
  })
}

/** 批量修改实施状态；每株受影响古树只按现存「已完成」措施重算一次最近复壮日期 */
export async function batchSetMeasureState(ids: string[], state: MeasureState): Promise<number> {
  if (ids.length === 0) return 0
  return db.transaction('rw', db.trees, db.measures, async () => {
    const rows = await db.measures.bulkGet(ids)
    const list = rows.filter((row): row is Measure => row !== undefined)
    const stamp = nowIso()
    await db.measures.bulkPut(
      list.map((row) => ({ ...row, state, updatedAt: stamp, revision: ROW_REVISION }))
    )
    const affected = new Set<string>(list.map((row) => row.treeId))
    for (const treeId of affected) {
      await syncTreeLastMeasureDate(treeId)
    }
    return list.length
  })
}

/* ------------------------------ 加固件 ------------------------------ */

export async function listSupports(): Promise<Support[]> {
  const rows = await db.supports.toArray()
  return rows.sort((a, b) => a.installDate.localeCompare(b.installDate))
}

export async function listSupportsByTree(treeId: string): Promise<Support[]> {
  return db.supports.where('treeId').equals(treeId).toArray()
}

export async function putSupport(row: Support): Promise<void> {
  await db.supports.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION })
}

export async function removeSupport(id: string): Promise<void> {
  await db.supports.delete(id)
}

/** 登记本次检查：把最近检查日期置为给定日期（默认今天） */
export async function markSupportChecked(id: string, date = today()): Promise<void> {
  await db.supports.update(id, { lastCheckDate: date, updatedAt: nowIso() })
}

/* ------------------------------ 长势复评 ------------------------------ */

export async function listReviews(): Promise<Review[]> {
  const rows = await db.reviews.toArray()
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

export async function listReviewsByTree(treeId: string): Promise<Review[]> {
  const rows = await db.reviews.where('treeId').equals(treeId).toArray()
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export async function putReview(row: Review): Promise<void> {
  await db.reviews.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION })
}

export async function removeReview(id: string): Promise<void> {
  await db.reviews.delete(id)
}

/* ---------------------------- 整库快照 ---------------------------- */

export interface DatabaseSnapshot {
  name: string
  schemaVersion: number
  exportedAt: string
  trees: Tree[]
  surveys: Survey[]
  measures: Measure[]
  supports: Support[]
  reviews: Review[]
}

/** 导出整库快照 */
export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [trees, surveys, measures, supports, reviews] = await Promise.all([
    db.trees.toArray(),
    db.surveys.toArray(),
    db.measures.toArray(),
    db.supports.toArray(),
    db.reviews.toArray(),
  ])
  return { name: DB_NAME, schemaVersion: DB_SCHEMA_VERSION, exportedAt: nowIso(), trees, surveys, measures, supports, reviews }
}

/** 用快照覆盖整库（导入存档） */
export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  await db.transaction('rw', db.trees, db.surveys, db.measures, db.supports, db.reviews, async () => {
    await Promise.all([
      db.trees.clear(),
      db.surveys.clear(),
      db.measures.clear(),
      db.supports.clear(),
      db.reviews.clear(),
    ])
    await db.trees.bulkPut(snapshot.trees.map((row) => ({ ...row, revision: ROW_REVISION })))
    await db.surveys.bulkPut(snapshot.surveys.map((row) => ({ ...row, revision: ROW_REVISION })))
    await db.measures.bulkPut(snapshot.measures.map((row) => ({ ...row, revision: ROW_REVISION })))
    await db.supports.bulkPut(snapshot.supports.map((row) => ({ ...row, revision: ROW_REVISION })))
    await db.reviews.bulkPut(snapshot.reviews.map((row) => ({ ...row, revision: ROW_REVISION })))
    // 存档里的 lastMeasureDate 可能是只增不退的旧值，统一按现存「已完成」措施重算
    for (const tree of snapshot.trees) {
      await syncTreeLastMeasureDate(tree.id)
    }
  })
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', db.trees, db.surveys, db.measures, db.supports, db.reviews, async () => {
    await Promise.all([
      db.trees.clear(),
      db.surveys.clear(),
      db.measures.clear(),
      db.supports.clear(),
      db.reviews.clear(),
    ])
  })
  await seedDatabase()
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [trees, surveys, measures, supports, reviews] = await Promise.all([
    db.trees.count(),
    db.surveys.count(),
    db.measures.count(),
    db.supports.count(),
    db.reviews.count(),
  ])
  return { trees, surveys, measures, supports, reviews }
}
