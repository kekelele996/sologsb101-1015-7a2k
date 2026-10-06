/**
 * 树体检查（Survey）
 * 每次检查记录树高、胸径、冠幅、倾斜度、空洞数与立地状况。
 */

/** 立地状况：铺装 / 裸土 / 积水 */
export type SiteNote = '铺装' | '裸土' | '积水'

export const SITE_NOTE_OPTIONS: SiteNote[] = ['铺装', '裸土', '积水']

export interface Survey {
  id: string
  /** 所属古树 */
  treeId: string
  /** 检查日期 YYYY-MM-DD */
  date: string
  /** 树高（米） */
  heightM: number
  /** 胸径（厘米） */
  dbhCm: number
  /** 冠幅（米） */
  crownM: number
  /** 倾斜度（度） */
  leanDeg: number
  /** 空洞数（个） */
  hollowCount: number
  /** 立地状况 */
  siteNote: SiteNote
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑树体检查的表单草稿 */
export interface SurveyDraft {
  treeId: string
  date: string
  heightM: number
  dbhCm: number
  crownM: number
  leanDeg: number
  hollowCount: number
  siteNote: SiteNote
}
