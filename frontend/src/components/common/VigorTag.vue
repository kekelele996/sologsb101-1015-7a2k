<script setup lang="ts">
/**
 * <VigorTag> 长势标签
 * 按 旺盛 / 一般 / 衰弱 / 濒危 渲染底色与图标，被古树档案页、加固件页、复评页消费。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { CircleCheck, InfoFilled, Warning, WarningFilled } from '@element-plus/icons-vue'
import type { Trend, Vigor } from '@/types/review'

const props = withDefaults(
  defineProps<{
    vigor?: Vigor | null
    /** 长势趋势，传入后在长势后追加箭头说明 */
    trend?: Trend | null
    /** 是否展示趋势文本 */
    showTrend?: boolean
    size?: 'default' | 'small'
  }>(),
  {
    vigor: null,
    trend: null,
    showTrend: true,
    size: 'default',
  }
)

type TagType = 'success' | 'info' | 'warning' | 'danger'

const TYPE_MAP: Record<Vigor, TagType> = {
  旺盛: 'success',
  一般: 'info',
  衰弱: 'warning',
  濒危: 'danger',
}

const ICON_MAP: Record<Vigor, Component> = {
  旺盛: CircleCheck,
  一般: InfoFilled,
  衰弱: Warning,
  濒危: WarningFilled,
}

const HINT_MAP: Record<Vigor, string> = {
  旺盛: '树势旺盛，按常规周期养护即可',
  一般: '长势一般，需关注立地与水分管理',
  衰弱: '长势衰弱，必须登记后续复壮措施',
  濒危: '长势濒危，须列入抢救名单并强制填写后续措施',
}

const tagType = computed<TagType>(() => (props.vigor === null ? 'info' : TYPE_MAP[props.vigor]))
const iconComponent = computed<Component>(() => (props.vigor === null ? InfoFilled : ICON_MAP[props.vigor]))
const hint = computed<string>(() => (props.vigor === null ? '尚无长势复评记录' : HINT_MAP[props.vigor]))

const TREND_TEXT: Record<Trend, string> = { 好转: '↑ 好转', 持平: '→ 持平', 下降: '↓ 下降' }
const TREND_CLASS: Record<Trend, string> = { 好转: 'is-up', 持平: 'is-flat', 下降: 'is-down' }
</script>

<template>
  <el-tooltip :content="hint" placement="top">
    <span class="vigor-tag" :class="[`is-${size}`]">
      <el-tag :type="tagType" :size="size === 'small' ? 'small' : 'default'" effect="light">
        <el-icon class="vigor-tag__icon"><component :is="iconComponent" /></el-icon>
        <span>{{ vigor ?? '未复评' }}</span>
      </el-tag>
      <em v-if="showTrend && trend" class="vigor-tag__trend" :class="TREND_CLASS[trend]">{{ TREND_TEXT[trend] }}</em>
    </span>
  </el-tooltip>
</template>

<style scoped>
.vigor-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.vigor-tag__icon {
  margin-right: 3px;
  vertical-align: -2px;
}

.vigor-tag__trend {
  font-style: normal;
  font-size: 12px;
  color: #8c8479;
}

.vigor-tag__trend.is-up {
  color: #1e8449;
}

.vigor-tag__trend.is-down {
  color: #c0392b;
}
</style>
