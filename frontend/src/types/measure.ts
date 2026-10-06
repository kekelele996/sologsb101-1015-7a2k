/**
 * 复壮措施（Measure）
 * 换土、施肥、透气、树洞修补、病虫害防治等，按实施状态跟踪。
 */

/** 措施类型 */
export type MeasureType = '换土' | '施肥' | '透气' | '树洞修补' | '病虫害防治'

/** 实施状态：计划 / 实施中 / 已完成 */
export type MeasureState = '计划' | '实施中' | '已完成'

export const MEASURE_TYPE_OPTIONS: MeasureType[] = ['换土', '施肥', '透气', '树洞修补', '病虫害防治']
export const MEASURE_STATE_OPTIONS: MeasureState[] = ['计划', '实施中', '已完成']

export interface Measure {
  id: string
  /** 所属古树 */
  treeId: string
  /** 措施类型 */
  type: MeasureType
  /** 实施日期 YYYY-MM-DD */
  date: string
  /** 材料 */
  material: string
  /** 负责人 */
  operator: string
  /** 实施状态 */
  state: MeasureState
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑复壮措施的表单草稿 */
export interface MeasureDraft {
  treeId: string
  type: MeasureType
  date: string
  material: string
  operator: string
  state: MeasureState
}
