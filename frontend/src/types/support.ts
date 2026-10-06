/**
 * 加固件（Support）
 * 支撑杆、拉纤、避雷设施，按检查周期自动提示超期未检查。
 */

/** 加固件类型 */
export type SupportType = '支撑杆' | '拉纤' | '避雷'

export const SUPPORT_TYPE_OPTIONS: SupportType[] = ['支撑杆', '拉纤', '避雷']

export interface Support {
  id: string
  /** 所属古树 */
  treeId: string
  /** 类型 */
  type: SupportType
  /** 安装日期 YYYY-MM-DD */
  installDate: string
  /** 检查周期（月） */
  checkCycleMon: number
  /** 最近检查日期 YYYY-MM-DD */
  lastCheckDate: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑加固件的表单草稿 */
export interface SupportDraft {
  treeId: string
  type: SupportType
  installDate: string
  checkCycleMon: number
  lastCheckDate: string
}
