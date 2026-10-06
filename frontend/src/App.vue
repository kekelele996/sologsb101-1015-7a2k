<script setup lang="ts">
/**
 * 应用外壳：顶部导航 + 当前古树上下文 + 内容区 + 页脚
 * 同时负责初始化本地数据库与 Pinia store 的数据订阅。
 */
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Coin, Files, FirstAidKit, Histogram, OfficeBuilding } from '@element-plus/icons-vue'
import { useTreeStore } from '@/stores/treeStore'
import { useMeasureStore } from '@/stores/measureStore'
import { useReviewStore } from '@/stores/reviewStore'
import { ROUTES } from '@/router'

const route = useRoute()
const router = useRouter()
const treeStore = useTreeStore()
const measureStore = useMeasureStore()
const reviewStore = useReviewStore()

const navItems = computed(() => {
  const currentTreeId = treeStore.currentTreeId
  return [
    { path: ROUTES.trees, label: '古树档案', icon: OfficeBuilding, badge: String(treeStore.trees.length) },
    {
      path: currentTreeId ? ROUTES.surveys(currentTreeId) : ROUTES.trees,
      label: '树体检查',
      icon: Files,
      badge: String(treeStore.surveys.length),
      disabled: currentTreeId === null,
    },
    { path: ROUTES.measures, label: '复壮措施', icon: FirstAidKit, badge: String(treeStore.measures.length) },
    { path: ROUTES.supports, label: '加固件', icon: Coin, badge: String(treeStore.supports.length) },
    { path: ROUTES.reviews, label: '长势复评', icon: Histogram, badge: String(treeStore.reviews.length) },
  ]
})

const activePath = computed<string>(() => {
  if (route.path.startsWith('/trees/')) {
    const id = treeStore.currentTreeId
    return id === null ? ROUTES.trees : ROUTES.surveys(id)
  }
  return route.path
})

const overdueCount = computed<number>(() => treeStore.overdueSupports.length)

onMounted(() => {
  void treeStore.loadAll()
  void measureStore.init()
  void reviewStore.init()
})

function go(path: string): void {
  void router.push(path)
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header__brand">
        <span class="app-header__mark">树</span>
        <div>
          <h1 class="app-header__title">古树名木复壮养护档案</h1>
          <p class="app-header__sub">gbheritagetree · 一树一档 · 检查 / 复壮 / 加固 / 复评</p>
        </div>
      </div>
      <nav class="app-nav">
        <button
          v-for="item in navItems"
          :key="item.label"
          class="app-nav__item"
          :class="{ 'is-active': activePath === item.path, 'is-disabled': item.disabled }"
          type="button"
          :disabled="item.disabled"
          @click="go(item.path)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <em v-if="item.badge !== '0'" class="app-nav__badge">{{ item.badge }}</em>
        </button>
      </nav>
      <div class="app-header__meta">
        <el-tag v-if="treeStore.currentTree" type="success" effect="dark">
          当前古树：{{ treeStore.currentTree.code }} {{ treeStore.currentTree.species }}
        </el-tag>
        <el-tag v-else type="info">未选择古树</el-tag>
        <el-tag v-if="overdueCount > 0" type="danger" effect="dark">加固件超期 {{ overdueCount }} 件</el-tag>
      </div>
    </header>

    <main class="app-main">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <footer class="app-footer">
      <span>数据仅存于本浏览器（IndexedDB 库名 gbheritagetree / localStorage），不上传任何服务器。</span>
      <span>结构版本 v{{ treeStore.counts.schemaVersion ?? '-' }}</span>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: linear-gradient(120deg, #2f3a24 0%, #4a5a30 55%, #6b7a3f 100%);
  color: #f5f2e6;
}

.app-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-header__mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 20px;
  font-weight: 700;
}

.app-header__title {
  margin: 0;
  font-size: 18px;
  letter-spacing: 2px;
}

.app-header__sub {
  margin: 2px 0 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(245, 242, 230, 0.75);
}

.app-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.app-nav__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #f5f2e6;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.app-nav__item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.app-nav__item.is-active {
  background: #f5f2e6;
  color: #4a5a30;
  font-weight: 600;
}

.app-nav__item.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-nav__badge {
  font-style: normal;
  font-size: 11px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.app-header__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.app-main {
  flex: 1;
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  padding: 20px 24px 32px;
}

.app-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 24px 20px;
  font-size: 12px;
  color: #8c8479;
}
</style>
