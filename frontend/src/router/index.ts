/**
 * 路由表：/trees、/trees/:id/surveys、/measures、/supports、/reviews
 * 层级路由支持直接深链访问（配合 nginx try_files 回退）；页面按路由懒加载自动分包。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/** 路由路径常量：全项目唯一来源，避免手写字符串不一致 */
export const ROUTES = {
  trees: '/trees',
  surveys: (treeId: string): string => `/trees/${treeId}/surveys`,
  measures: '/measures',
  supports: '/supports',
  reviews: '/reviews',
} as const

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: ROUTES.trees },
  {
    path: '/trees',
    name: 'tree-list',
    component: () => import('@/pages/TreeList.vue'),
    meta: { title: '古树一树一档' },
  },
  {
    path: '/trees/:id/surveys',
    name: 'tree-survey',
    component: () => import('@/pages/TreeSurvey.vue'),
    meta: { title: '树体与立地检查' },
  },
  {
    path: '/measures',
    name: 'measure-board',
    component: () => import('@/pages/MeasureBoard.vue'),
    meta: { title: '复壮措施台账' },
  },
  {
    path: '/supports',
    name: 'support-board',
    component: () => import('@/pages/SupportBoard.vue'),
    meta: { title: '支撑加固与避雷件' },
  },
  {
    path: '/reviews',
    name: 'review-view',
    component: () => import('@/pages/ReviewView.vue'),
    meta: { title: '长势复评与结构版本' },
  },
  { path: '/:pathMatch(.*)*', redirect: ROUTES.trees },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '古树名木复壮养护档案'
  document.title = `${title} · 古树名木复壮养护档案`
})

export default router
