<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  achievementChoiceRulesFor,
  alternativeGroupItemIds,
  buildAlternativeGroups,
  buildBaseEntries,
  buildCraftPlan,
  CATEGORIES,
  checkQuestPlannerDataStatus,
  ensureItems,
  expandAchievementToQuests,
  loadQuestPlannerData,
  parseClipboardQuests,
  searchQuestsAndCategories,
  syncQuestPlannerImages,
  syncQuestPlannerData,
  syncCharacteristicSupportData,
  type AchievementChoiceOption,
  type AchievementChoiceRule,
  type AchievementInfo,
  type AlternativeItemGroupEntry,
  type AlternativeItemLine,
  type CraftLine,
  type DatabaseStatus,
  type CraftPlan,
  type ItemEntry,
  type QuestInfo,
  type QuestPlannerData,
  type QuestSyncProgressEvent,
  type SearchResult,
} from './questLogic'
import { allocateOwned, setCraftLineAllocation, type OwnedQuantities } from './possession'
import { compareItemIds } from './resourceSort'
import {
  acquireSharedSyncLock,
  clearCachedImages,
  heartbeatSharedSyncLock,
  loadCachedImagesForIds,
  readSharedSyncLock,
  releaseSharedSyncLock,
  saveFailedCachedImages,
  type SharedSyncLock,
} from './questStorage'

type AppUpdate = {
  currentVersion: string
  version: string
  date?: string
  body?: string
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
}
type DownloadEvent = {
  event: 'Started' | 'Progress' | 'Finished'
  data?: {
    contentLength?: number
    chunkLength?: number
  }
}

const data = ref<QuestPlannerData | null>(null)
const loading = ref(true)
const syncing = ref(false)
const status = ref('Chargement des données locales...')
const themeMode = ref<'dark' | 'light'>('dark')
const questQuery = ref('')
const questSearchOpen = ref(false)
const selectedQuests = ref<QuestInfo[]>([])
const pendingAchievement = ref<AchievementInfo | null>(null)
const pendingAchievementQueue = ref<AchievementInfo[]>([])
const pendingChoiceRules = ref<AchievementChoiceRule[]>([])
const pendingChoiceValues = ref<Record<number, string>>({})
const currentEntries = ref<ItemEntry[]>([])
const currentAlternativeGroups = ref<AlternativeItemGroupEntry[]>([])
const checkedItemIds = ref<Set<number>>(new Set())
const ownedQuantities = ref<OwnedQuantities>({})
const selectedAlternativeOptionKeys = ref<Record<string, string>>({})
const craftPlan = ref<CraftPlan | null>(null)
const craftCheckedKeys = ref<Set<string>>(new Set())
const craftOpen = ref(false)
const choiceOpen = ref(false)
const appUpdate = shallowRef<AppUpdate | null>(null)
const cachedImageUrls = ref<Map<number, string>>(new Map())
const showAppUpdatePrompt = ref(false)
const checkingAppUpdate = ref(false)
const installingAppUpdate = ref(false)
const appUpdateProgress = ref('')
let autoComputeTimer: number | undefined
let overflowUpdateFrame: number | undefined
let wheelQuantityLockUntil = 0
const WHEEL_QUANTITY_LOCK_MS = 650
const quantityFormatter = new Intl.NumberFormat('fr-FR')
const byteFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const FORCE_FULL_SYNC_KEY = 'questplanner-force-full-sync'
const FORCE_FULL_SYNC_PARAM = 'forceFullSync'
const EXTERNAL_SYNC_IDLE_CONFIRM_MS = 3500
const ESTIMATED_IMAGE_BYTES = 40 * 1024

type SyncTaskKey = 'items' | 'recipes' | 'itemSets' | 'characteristics' | 'images' | 'statIcons'

interface SyncTaskState {
  key: SyncTaskKey
  label: string
  done: number
  total: number
  bytesDone: number
  bytesTotal?: number
}

const syncTaskOrder: SyncTaskKey[] = ['items', 'recipes', 'itemSets', 'characteristics', 'images', 'statIcons']
const syncTaskLabels: Record<SyncTaskKey, string> = {
  items: 'Items',
  recipes: 'Recettes',
  itemSets: 'Panoplies',
  characteristics: 'Stats',
  images: 'Images',
  statIcons: 'Icônes stats',
}

function createSyncTasks(): Record<SyncTaskKey, SyncTaskState> {
  return Object.fromEntries(syncTaskOrder.map((key) => [key, {
    key,
    label: syncTaskLabels[key],
    done: 0,
    total: 0,
    bytesDone: 0,
  }])) as Record<SyncTaskKey, SyncTaskState>
}

const syncVisible = ref(false)
const syncExternalWait = ref(false)
const syncPhase = ref('Vérification des données DofusDB...')
const syncStartedAt = ref(Date.now())
const syncUpdatedAt = ref(Date.now())
const syncMeasuredSpeed = ref(0)
const syncTasks = ref<Record<SyncTaskKey, SyncTaskState>>(createSyncTasks())
let syncSpeedSamples: Array<{ at: number; bytesDone: number }> = []
let syncHideTimer: number | undefined

const questCount = computed(() => Object.keys(data.value?.quests || {}).length)
const achievementCount = computed(() => Object.keys(data.value?.achievements || {}).length)
const itemCount = computed(() => Object.keys(data.value?.items || {}).length)
const recipeCount = computed(() => Object.keys(data.value?.recipes || {}).length)
const syncRows = computed(() => {
  const rows = syncTaskOrder.map((key) => syncTasks.value[key])
  return syncVisible.value ? rows : rows.filter((task) => task.total > 0 || task.done > 0)
})
const syncTotals = computed(() => {
  const rows = syncRows.value
  const estimatedBytesTotal = rows.reduce((total, task) => total + estimatedTaskBytesTotal(task), 0)
  return {
    done: rows.reduce((total, task) => total + task.done, 0),
    total: rows.reduce((total, task) => total + task.total, 0),
    bytesDone: rows.reduce((total, task) => total + task.bytesDone, 0),
    estimatedBytesTotal,
  }
})
const syncPercent = computed(() => {
  const countPercent = syncTotals.value.total > 0
    ? Math.min(100, Math.round((syncTotals.value.done / syncTotals.value.total) * 100))
    : 0
  if (syncTotals.value.estimatedBytesTotal > 0) {
    const bytePercent = Math.min(100, Math.round((syncTotals.value.bytesDone / syncTotals.value.estimatedBytesTotal) * 100))
    return Math.max(bytePercent, countPercent)
  }
  return countPercent
})
const syncEta = computed(() => {
  syncUpdatedAt.value
  if (syncTotals.value.total > 0 && syncTotals.value.done >= syncTotals.value.total) return ''
  const speed = syncMeasuredSpeed.value
  const remainingBytes = Math.max(0, syncTotals.value.estimatedBytesTotal - syncTotals.value.bytesDone)
  if (speed > 0 && remainingBytes > 0) return formatDuration(remainingBytes / speed)
  const { done, total } = syncTotals.value
  if (!done || !total || done >= total) return ''
  const elapsedSeconds = Math.max(1, (Date.now() - syncStartedAt.value) / 1000)
  return formatDuration((elapsedSeconds / done) * (total - done))
})
const syncDownloadDetails = computed(() => {
  const bytesDone = syncTotals.value.bytesDone
  const estimatedTotal = syncTotals.value.estimatedBytesTotal
  const allProcessed = syncTotals.value.total > 0 && syncTotals.value.done >= syncTotals.value.total
  const remaining = Math.max(0, estimatedTotal - bytesDone)
  const totalText = estimatedTotal
    ? `${allProcessed || estimatedTotal <= bytesDone ? '' : '~'}${formatBytes(Math.max(estimatedTotal, bytesDone))}`
    : 'en estimation'
  return [
    { label: 'Total', value: totalText },
    { label: 'Restant', value: allProcessed ? '0 o' : (estimatedTotal ? `~${formatBytes(remaining)}` : 'en estimation') },
    { label: 'Vitesse', value: syncMeasuredSpeed.value > 0 ? `${formatBytes(syncMeasuredSpeed.value)}/s` : 'en estimation' },
    { label: 'Temps restant', value: syncEta.value ? `~${syncEta.value}` : (allProcessed ? '0 s' : 'en estimation') },
  ]
})

const searchResults = computed(() => {
  if (!data.value) return []
  return searchQuestsAndCategories(data.value, questQuery.value, 40)
})
const showSearchResults = computed(() => questSearchOpen.value && questQuery.value && searchResults.value.length)

const selectedQuestIds = computed(() => new Set(selectedQuests.value.map((quest) => quest.questId)))
const activeChoiceRule = computed(() => pendingChoiceRules.value.find((rule) => !pendingChoiceValues.value[rule.achievementId]) || null)
const questSidebarWidth = '430px'

const displayedEntries = computed(() => mergeItemEntries([...currentEntries.value, ...selectedAlternativeEntries()]))

const groupedEntries = computed(() => {
  const groups = Object.fromEntries(CATEGORIES.map((category) => [category, [] as ItemEntry[]]))
  displayedEntries.value.forEach((entry) => groups[entry.category].push(entry))
  CATEGORIES.forEach((category) => groups[category].sort(compareEntries))
  return groups
})

const groupedAlternativeGroups = computed(() => {
  const groups = Object.fromEntries(CATEGORIES.map((category) => [category, [] as AlternativeItemGroupEntry[]]))
  currentAlternativeGroups.value.forEach((group) => groups[group.category].push(group))
  CATEGORIES.forEach((category) => groups[category].sort(compareAlternativeGroups))
  return groups
})

const remainingEntries = computed(() => displayedEntries.value.filter((entry) => !isEntryDone(entry)))
const unresolvedAlternativeGroups = computed(() =>
  currentAlternativeGroups.value.filter((group) => !selectedAlternativeOptionKeys.value[group.group_key]),
)
const craftTargetCount = computed(() => remainingEntries.value.length)
const choiceTotalCount = computed(() => currentAlternativeGroups.value.length)
const choiceResolvedCount = computed(() =>
  currentAlternativeGroups.value.filter((group) => selectedAlternativeOptionKeys.value[group.group_key]).length,
)

const craftPanels = computed(() => {
  const plan = craftPlan.value
  if (!plan) return []
  return [
    { key: 'base', title: 'Base à craft', lines: sortCraftLines(plan.direct_crafts) },
    { key: 'subcrafts', title: 'Sous-crafts', lines: sortCraftLines(plan.sub_crafts) },
    { key: 'ingredients', title: 'Ingrédients', lines: sortCraftLines(mergeCraftLines('ingredients', [...plan.craft_resources, ...plan.base_direct, ...plan.excluded])) },
  ]
})

const rawCraftLines = computed(() => {
  const plan = craftPlan.value
  if (!plan) return []
  return [
    ...plan.direct_crafts,
    ...plan.sub_crafts,
    ...mergeCraftLines('ingredients', [...plan.craft_resources, ...plan.base_direct, ...plan.excluded]),
  ]
})
const displayedCraftLines = computed(() => craftPanels.value.flatMap((section) => section.lines))
const craftCheckedCount = computed(() => displayedCraftLines.value.filter((line) => craftRowState(line).done).length)
const entryLines = computed(() => displayedEntries.value.map(entryToCraftLine))
const allocatableLines = computed(() => {
  if (!rawCraftLines.value.length) return entryLines.value
  const lines = [...rawCraftLines.value]
  entryLines.value.forEach((entryLine) => {
    if (!lines.some((line) => line.item_id === entryLine.item_id && craftLineCompletesBaseItem(line))) {
      lines.unshift(entryLine)
    }
  })
  return lines
})
const ownedAllocations = computed(() => allocateOwned(allocatableLines.value, ownedQuantities.value))

function addCoveredDependencies(covered: Map<number, number>, line: CraftLine, progress: number): void {
  const plan = craftPlan.value
  if (!plan || progress <= 0 || line.quantity <= 0) return
  Object.entries(plan.dependencies[line.line_key] || {}).forEach(([childId, childQuantity]) => {
    const coveredQuantity = Math.round((Number(childQuantity) * progress) / line.quantity)
    if (!coveredQuantity) return
    covered.set(Number(childId), (covered.get(Number(childId)) || 0) + coveredQuantity)
  })
}

const coveredByItemId = computed(() => {
  const covered = new Map<number, number>()
  const plan = craftPlan.value
  if (!plan) return covered

  rawCraftLines.value.forEach((line) => {
    if (!craftLineCanCoverDependencies(line)) return
    addCoveredDependencies(covered, line, ownedAllocations.value[line.line_key] || 0)
  })

  return covered
})

function imageUrl(path: string | undefined, itemId?: number): string {
  if (itemId && cachedImageUrls.value.has(itemId)) return cachedImageUrls.value.get(itemId)!
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return ''
  if (path.startsWith('/')) return path
  return path ? `/${path.replace(/\\/g, '/')}` : ''
}

function visibleImageIds(): number[] {
  const ids = [
    ...displayedEntries.value.map((entry) => entry.item_id),
    ...displayedCraftLines.value.map((line) => line.item_id),
    ...currentAlternativeGroups.value.flatMap((group) =>
      group.options.flatMap((option) => option.items.map((item) => item.item_id))),
  ]
  return ids.filter((id): id is number => Number.isFinite(id))
}

async function ensureCachedImageUrlsForIds(itemIds: Iterable<number>): Promise<void> {
  const source = data.value
  if (!source) return
  const ids = [...new Set([...itemIds].map((id) => Number(id)).filter(Number.isFinite))]
    .filter((itemId) => !cachedImageUrls.value.has(itemId))
    .filter((itemId) => {
      const item = source.items[String(itemId)]
      return item && !item.image_path && item.image_url
    })
  if (!ids.length) return
  const cached = await loadCachedImagesForIds(ids).catch(() => [])
  if (!cached.length) return
  const next = new Map(cachedImageUrls.value)
  cached.forEach(({ itemId, blob }) => {
    if (!next.has(itemId)) next.set(itemId, URL.createObjectURL(blob))
  })
  cachedImageUrls.value = next
}

async function ensureVisibleCachedImageUrls(): Promise<void> {
  await ensureCachedImageUrlsForIds(visibleImageIds())
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
}

function isSmokeMode(): boolean {
  try {
    return sessionStorage.getItem('questplanner-smoke-mode') === '1'
  } catch {
    return false
  }
}

async function openDofusDb(kind: 'object' | 'quest' | 'achievement', id: number): Promise<void> {
  const url = `https://dofusdb.fr/database/${kind}/${id}`
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_external_url', { url })
      return
    } catch {
      // Browser fallback below also keeps the dev server behavior simple.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function checkAppUpdate(): Promise<void> {
  if (!isTauriRuntime() || checkingAppUpdate.value || installingAppUpdate.value) return
  checkingAppUpdate.value = true
  appUpdateProgress.value = ''
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (update) {
      appUpdate.value = update
      showAppUpdatePrompt.value = true
      status.value = `Mise à jour ${update.version} requise`
      checkingAppUpdate.value = false
      await installAppUpdate()
      return
    }
    appUpdate.value = null
    showAppUpdatePrompt.value = false
  } catch (error) {
    status.value = `Vérification maj impossible : ${String(error)}`
  } finally {
    checkingAppUpdate.value = false
  }
}

async function acquireAppUpdateLock(): Promise<() => void> {
  let heartbeatTimer: number | undefined
  while (true) {
    try {
      const lockStatus = await acquireSharedSyncLock('QuestPlanner', 'app-update')
      if (lockStatus.acquired) {
        heartbeatTimer = window.setInterval(() => {
          void heartbeatSharedSyncLock('QuestPlanner', 'app-update').catch(() => {})
        }, 1000)
        return () => {
          if (heartbeatTimer) window.clearInterval(heartbeatTimer)
          void releaseSharedSyncLock().catch(() => {})
        }
      }
      const owner = lockStatus.lock?.app || 'Une autre app'
      appUpdateProgress.value = `${owner} termine une opération commune. QuestPlanner attend son tour...`
      await sleep(1500)
    } catch {
      // If the shared lock is unavailable, keep the updater usable.
      return () => {}
    }
  }
}

async function installAppUpdate(): Promise<void> {
  if (installingAppUpdate.value) return
  if (!appUpdate.value) return
  installingAppUpdate.value = true
  showAppUpdatePrompt.value = true
  appUpdateProgress.value = 'Préparation de la mise à jour...'
  let downloaded = 0
  let total: number | undefined
  let releaseAppUpdateLock: (() => void) | null = null
  try {
    releaseAppUpdateLock = await acquireAppUpdateLock()
    appUpdateProgress.value = 'Téléchargement de la mise à jour...'
    await appUpdate.value.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        downloaded = 0
        total = event.data?.contentLength
        appUpdateProgress.value = total ? `Téléchargement : 0/${Math.round(total / 1024 / 1024)} Mo` : 'Téléchargement...'
      } else if (event.event === 'Progress') {
        downloaded += event.data?.chunkLength || 0
        appUpdateProgress.value = total
          ? `Téléchargement : ${Math.min(100, Math.round((downloaded / total) * 100))}%`
          : `Téléchargement : ${Math.round(downloaded / 1024 / 1024)} Mo`
      } else {
        appUpdateProgress.value = 'Installation terminée, redémarrage...'
      }
    })
    releaseAppUpdateLock()
    releaseAppUpdateLock = null
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (error) {
    appUpdateProgress.value = `Mise à jour impossible : ${String(error)}`
    status.value = appUpdateProgress.value
  } finally {
    if (releaseAppUpdateLock) releaseAppUpdateLock()
    installingAppUpdate.value = false
  }
}

function setItemChecked(itemId: number, checked: boolean): void {
  const next = new Set(checkedItemIds.value)
  if (checked) next.add(itemId)
  else next.delete(itemId)
  checkedItemIds.value = next

  const entry = displayedEntries.value.find((candidate) => candidate.item_id === itemId)
  if (!entry) return
  changeEntryOwned(entry, checked ? entry.quantity : 0)
}

function selectAlternativeOption(groupKey: string, optionKey: string): void {
  const next = { ...selectedAlternativeOptionKeys.value }
  if (next[groupKey] === optionKey) delete next[groupKey]
  else next[groupKey] = optionKey
  selectedAlternativeOptionKeys.value = next

  craftPlan.value = null
  craftCheckedKeys.value = new Set()
  craftOpen.value = false
  if (allAlternativeGroupsResolved(next)) choiceOpen.value = false
}

function setCraftChecked(line: CraftLine, checked: boolean): void {
  const next = new Set(craftCheckedKeys.value)
  if (checked && craftLineCanCoverDependencies(line)) next.add(line.line_key)
  else next.delete(line.line_key)
  craftCheckedKeys.value = next

  const desiredOwned = checked ? line.quantity : 0
  ownedQuantities.value = setCraftLineAllocation(ownedQuantities.value, allocatableLines.value, line.line_key, desiredOwned)

  if (craftLineCompletesBaseItem(line) && checked) {
    checkedItemIds.value = new Set([...checkedItemIds.value, line.item_id])
  } else if (craftLineCompletesBaseItem(line) && !checked) {
    const nextItems = new Set(checkedItemIds.value)
    nextItems.delete(line.item_id)
    checkedItemIds.value = nextItems
  }
}

function isEntryDone(entry: ItemEntry): boolean {
  return entryOwned(entry) >= entry.quantity
}

function isAlternativeOptionSelected(group: AlternativeItemGroupEntry, optionKey: string): boolean {
  return selectedAlternativeOptionKeys.value[group.group_key] === optionKey
}

function isAlternativeGroupResolved(group: AlternativeItemGroupEntry): boolean {
  return Boolean(selectedAlternativeOptionKeys.value[group.group_key])
}

function allAlternativeGroupsResolved(selected: Record<string, string>): boolean {
  return currentAlternativeGroups.value.length > 0
    && currentAlternativeGroups.value.every((group) => Boolean(selected[group.group_key]))
}

function categoryTitle(category: string): string {
  return category === 'Equipement' ? 'Equipements' : `${category}s`
}

function categoryProgress(category: string): string {
  const entries = groupedEntries.value[category] || []
  const checked = entries.filter((entry) => isEntryDone(entry)).length
  return `${formatQuantity(checked)}/${formatQuantity(entries.length)}`
}

function formatQuantity(value: number): string {
  return quantityFormatter.format(Math.max(0, Math.floor(Number(value) || 0)))
}

function formatBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${formatQuantity(bytes)} o`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${byteFormatter.format(kilobytes)} Ko`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${byteFormatter.format(megabytes)} Mo`
  return `${byteFormatter.format(megabytes / 1024)} Go`
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remainingSeconds = rounded % 60
  if (!minutes) return `${remainingSeconds} s`
  if (!remainingSeconds) return `${minutes} min`
  return `${minutes} min ${remainingSeconds} s`
}

function estimatedTaskBytesTotal(task: SyncTaskState): number {
  if (task.done > 0 && task.total > 0) {
    const averageEstimate = (task.bytesDone / task.done) * task.total
    return Math.max(task.bytesDone, task.bytesTotal || 0, averageEstimate)
  }
  return Math.max(task.bytesDone, task.bytesTotal || 0)
}

function quantityTotalWidth(category: string): string {
  const entries = groupedEntries.value[category] || []
  const chars = entries.reduce((maximum, entry) => Math.max(maximum, formatQuantity(entry.quantity).length), 1)
  return `${10 + chars * 8}px`
}

function quantityInputWidthForValues(values: number[]): string {
  const chars = values.reduce((maximum, value) => Math.max(maximum, String(Math.max(0, Math.floor(value))).length), 1)
  return `${Math.max(42, 14 + chars * 8)}px`
}

function quantityInputWidth(category: string): string {
  const entries = groupedEntries.value[category] || []
  return quantityInputWidthForValues(entries.map((entry) => entry.quantity))
}

function craftQuantityTotalWidth(lines: CraftLine[]): string {
  const chars = lines.reduce((maximum, line) => Math.max(maximum, formatQuantity(line.quantity).length), 1)
  return `${10 + chars * 8}px`
}

function craftQuantityInputWidth(lines: CraftLine[]): string {
  return quantityInputWidthForValues(lines.map((line) => line.quantity))
}

function choicePanelProgress(category: string): string {
  const alternatives = groupedAlternativeGroups.value[category] || []
  const resolved = alternatives.filter((group) => selectedAlternativeOptionKeys.value[group.group_key]).length
  return `${formatQuantity(resolved)}/${formatQuantity(alternatives.length)}`
}

function craftPanelProgress(section: { lines: CraftLine[] }): string {
  const checked = section.lines.filter((line) => craftRowState(line).done).length
  return `${formatQuantity(checked)}/${formatQuantity(section.lines.length)}`
}

function itemSubtype(itemId: number, fallback = ''): string {
  const item = data.value?.items[String(itemId)]
  return item?.type_name || item?.raw_type || fallback || 'Item'
}

function entryMeta(entry: ItemEntry): string {
  return itemSubtype(entry.item_id, entry.raw_type)
}

function alternativeItemMeta(item: AlternativeItemLine): string {
  return itemSubtype(item.item_id, item.raw_type)
}

function selectedAlternativeEntries(): ItemEntry[] {
  const entries: ItemEntry[] = []

  currentAlternativeGroups.value.forEach((group) => {
    const optionKey = selectedAlternativeOptionKeys.value[group.group_key]
    const option = group.options.find((candidate) => candidate.option_key === optionKey)
    if (!option) return

    option.items.forEach((item, itemIndex) => {
      entries.push({
        item_id: item.item_id,
        quantity: item.quantity,
        name: item.name,
        category: item.category,
        raw_type: item.raw_type,
        image_url: '',
        image_path: item.image_path,
        source: 'Choix de prérequis',
        source_quests: group.source_quests,
        order: 10000 + group.order * 100 + itemIndex,
      })
    })
  })

  return entries
}

function mergeItemEntries(entries: ItemEntry[]): ItemEntry[] {
  const merged = new Map<number, ItemEntry>()

  entries.forEach((entry) => {
    const existing = merged.get(entry.item_id)
    if (!existing) {
      merged.set(entry.item_id, { ...entry, source_quests: [...entry.source_quests] })
      return
    }
    existing.quantity += entry.quantity
    existing.source_quests = Array.from(new Set([...existing.source_quests, ...entry.source_quests]))
    existing.order = Math.min(existing.order, entry.order)
  })

  return Array.from(merged.values())
}

function craftMeta(line: CraftLine): string {
  return itemSubtype(line.item_id, line.raw_type)
}

function craftLineCompletesBaseItem(line: CraftLine): boolean {
  return displayedEntries.value.some((entry) => entry.item_id === line.item_id)
    && (line.line_key.startsWith('direct_crafts:')
      || line.line_key.startsWith('base_direct:')
      || line.line_key.startsWith('excluded:')
      || line.line_key.startsWith('entry:'))
}

function craftLineCanCoverDependencies(line: CraftLine): boolean {
  return line.line_key.startsWith('direct_crafts:') || line.line_key.startsWith('sub_crafts:')
}

function entryToCraftLine(entry: ItemEntry): CraftLine {
  return {
    line_key: `entry:${entry.item_id}`,
    item_id: entry.item_id,
    quantity: entry.quantity,
    name: entry.name,
    raw_type: entry.raw_type,
    image_path: entry.image_path,
    meta: entry.source,
  }
}

function allocationLineForEntry(entry: ItemEntry): CraftLine {
  return allocatableLines.value.find((line) => line.item_id === entry.item_id && craftLineCompletesBaseItem(line))
    || entryToCraftLine(entry)
}

function entryOwned(entry: ItemEntry): number {
  return Math.min(ownedAllocations.value[allocationLineForEntry(entry).line_key] || 0, entry.quantity)
}

function changeEntryOwned(entry: ItemEntry, quantity: number): void {
  const line = allocationLineForEntry(entry)
  ownedQuantities.value = setCraftLineAllocation(ownedQuantities.value, allocatableLines.value, line.line_key, quantity)
  const next = new Set(checkedItemIds.value)
  if (quantity >= entry.quantity) next.add(entry.item_id)
  else next.delete(entry.item_id)
  checkedItemIds.value = next
}

function craftLineOwned(line: CraftLine): number {
  return ownedAllocations.value[line.line_key] || 0
}

function craftLineCovered(line: CraftLine): number {
  return Math.min(coveredByItemId.value.get(line.item_id) || 0, line.quantity)
}

function craftLineProgress(line: CraftLine): number {
  if (craftCheckedKeys.value.has(line.line_key)) return line.quantity
  return Math.min(line.quantity, craftLineOwned(line) + craftLineCovered(line))
}

function craftLineChecked(line: CraftLine): boolean {
  return craftLineProgress(line) >= line.quantity
}

function changeCraftOwned(line: CraftLine, quantity: number): void {
  const desiredProgress = Math.max(0, Math.min(Math.floor(Number(quantity) || 0), line.quantity))
  const desiredOwned = Math.max(0, desiredProgress - craftLineCovered(line))
  const nextOwned = setCraftLineAllocation(ownedQuantities.value, allocatableLines.value, line.line_key, desiredOwned)
  const nextAllocation = allocateOwned(allocatableLines.value, nextOwned)[line.line_key] || 0
  const nextProgress = Math.min(line.quantity, nextAllocation + craftLineCovered(line))
  ownedQuantities.value = nextOwned
  const nextCraft = new Set(craftCheckedKeys.value)
  if (craftLineCanCoverDependencies(line) && nextProgress >= line.quantity) {
    nextCraft.add(line.line_key)
  } else {
    nextCraft.delete(line.line_key)
  }
  craftCheckedKeys.value = nextCraft

  if (!craftLineCompletesBaseItem(line)) return
  const nextItems = new Set(checkedItemIds.value)
  if (nextProgress >= line.quantity) nextItems.add(line.item_id)
  else nextItems.delete(line.item_id)
  checkedItemIds.value = nextItems
}

function handleOwnedInputWheel(event: WheelEvent): void {
  const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('.owned-input[data-wheel-kind]')
  if (!input) return
  event.preventDefault()
  event.stopPropagation()
  if (Date.now() < wheelQuantityLockUntil) return
  const delta = event.deltaY < 0 ? 1 : -1
  if (input.dataset.wheelKind === 'entry') {
    const itemId = Number(input.dataset.itemId)
    const entry = displayedEntries.value.find((candidate) => candidate.item_id === itemId)
    if (entry) {
      const wasDone = isEntryDone(entry)
      changeEntryOwned(entry, entryOwned(entry) + delta)
      if (wasDone !== isEntryDone(entry)) wheelQuantityLockUntil = Date.now() + WHEEL_QUANTITY_LOCK_MS
    }
    return
  }
  if (input.dataset.wheelKind === 'craft') {
    const lineKey = input.dataset.lineKey
    const line = displayedCraftLines.value.find((candidate) => candidate.line_key === lineKey)
    if (line) {
      const wasDone = craftLineChecked(line)
      changeCraftOwned(line, craftLineProgress(line) + delta)
      if (wasDone !== craftLineChecked(line)) wheelQuantityLockUntil = Date.now() + WHEEL_QUANTITY_LOCK_MS
    }
  }
}

function sortKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
}

function compareText(a: string, b: string): number {
  return sortKey(a).localeCompare(sortKey(b), 'fr')
}

function compareEntries(a: ItemEntry, b: ItemEntry): number {
  return Number(isEntryDone(a)) - Number(isEntryDone(b))
    || (data.value ? compareItemIds(data.value, a.item_id, b.item_id) : compareText(entryMeta(a), entryMeta(b)))
    || compareText(entryMeta(a), entryMeta(b))
    || compareText(a.name, b.name)
    || a.order - b.order
}

function compareAlternativeGroups(a: AlternativeItemGroupEntry, b: AlternativeItemGroupEntry): number {
  return Number(isAlternativeGroupResolved(a)) - Number(isAlternativeGroupResolved(b))
    || a.order - b.order
    || compareText(a.label, b.label)
}

function compareCraftLines(a: CraftLine, b: CraftLine): number {
  return Number(craftRowState(a).done) - Number(craftRowState(b).done)
    || (data.value ? compareItemIds(data.value, a.item_id, b.item_id) : compareText(craftMeta(a), craftMeta(b)))
    || compareText(craftMeta(a), craftMeta(b))
    || compareText(a.name, b.name)
    || a.item_id - b.item_id
}

function sortCraftLines(lines: CraftLine[]): CraftLine[] {
  return [...lines].sort(compareCraftLines)
}

function mergeCraftLines(kind: string, lines: CraftLine[]): CraftLine[] {
  const merged = new Map<number, CraftLine>()
  lines.forEach((line) => {
    const existing = merged.get(line.item_id)
    if (!existing) {
      merged.set(line.item_id, { ...line, line_key: `${kind}:${line.item_id}` })
      return
    }
    existing.quantity += line.quantity
  })
  return Array.from(merged.values())
}

function addQuest(quest: QuestInfo): boolean {
  if (selectedQuestIds.value.has(quest.questId)) {
    status.value = `Déjà dans la liste : ${quest.name}`
    return false
  }
  selectedQuests.value = [...selectedQuests.value, quest]
  questQuery.value = ''
  questSearchOpen.value = false
  status.value = `Ajouté : ${quest.name}`
  return true
}

function addQuests(quests: QuestInfo[], sourceLabel: string): void {
  const existing = new Set(selectedQuests.value.map((quest) => quest.questId))
  const additions = quests.filter((quest) => !existing.has(quest.questId))
  selectedQuests.value = [...selectedQuests.value, ...additions]
  questQuery.value = ''
  questSearchOpen.value = false
  status.value = additions.length
    ? `${additions.length} quêtes ajoutées depuis ${sourceLabel}`
    : `Toutes les quêtes de ${sourceLabel} sont déjà dans la liste`
}

function startAchievementChoice(
  achievement: AchievementInfo,
  queuedAchievements: AchievementInfo[] = [],
  inheritedChoices: Record<number, string> = {},
): void {
  if (!data.value) return
  const requiredRules = achievementChoiceRulesFor(data.value, achievement.achievementId, inheritedChoices)
  if (!requiredRules.length) {
    addQuests(expandAchievementToQuests(data.value, achievement.achievementId, inheritedChoices), achievement.name)
    const nextAchievement = queuedAchievements[0]
    if (nextAchievement) startAchievementChoice(nextAchievement, queuedAchievements.slice(1), inheritedChoices)
    return
  }

  pendingAchievement.value = achievement
  pendingAchievementQueue.value = queuedAchievements
  pendingChoiceRules.value = requiredRules
  pendingChoiceValues.value = { ...inheritedChoices }
  const queuedSuffix = queuedAchievements.length ? ` (+${queuedAchievements.length} succès en attente)` : ''
  status.value = `Choix requis pour ${achievement.name}${queuedSuffix}`
}

function addAchievement(achievement: AchievementInfo): void {
  if (!data.value) return
  startAchievementChoice(achievement)
}

function addSearchResult(result: SearchResult): void {
  if (result.kind === 'quest') {
    addQuest(result)
    return
  }
  addAchievement(result)
}

function addFirstSearchResult(): void {
  const first = searchResults.value[0]
  if (first) addSearchResult(first)
}

function searchResultSelected(result: SearchResult): boolean {
  if (result.kind === 'quest') return selectedQuestIds.value.has(result.questId)
  if (!data.value) return false
  const quests = expandAchievementToQuests(data.value, result.achievementId)
  return quests.length > 0 && quests.every((quest) => selectedQuestIds.value.has(quest.questId))
}

function searchResultMeta(result: SearchResult): string {
  if (result.kind === 'quest') return `Quête · niv. ${result.levelMin} · ${result.categoryName || 'Sans catégorie'}`
  const questCount = result.needQuests.length
  const achievementCount = result.needAchievements.length
  const parts = [`Succès · ${result.points} pts`]
  if (questCount) parts.push(`${questCount} quêtes`)
  if (achievementCount) parts.push(`${achievementCount} succès`)
  if (result.categoryName) parts.push(result.categoryName)
  return parts.join(' · ')
}

function selectAchievementOption(option: AchievementChoiceOption): void {
  const rule = activeChoiceRule.value
  if (!rule || !pendingAchievement.value || !data.value) return

  const nextChoices = {
    ...pendingChoiceValues.value,
    [rule.achievementId]: option.key,
  }
  pendingChoiceValues.value = nextChoices

  const remainingRules = achievementChoiceRulesFor(data.value, pendingAchievement.value.achievementId, nextChoices)
  if (remainingRules.length) {
    pendingChoiceRules.value = remainingRules
    return
  }

  const achievement = pendingAchievement.value
  const nextAchievement = pendingAchievementQueue.value[0]
  const remainingQueuedAchievements = pendingAchievementQueue.value.slice(1)
  pendingAchievement.value = null
  pendingAchievementQueue.value = []
  pendingChoiceRules.value = []
  pendingChoiceValues.value = {}
  addQuests(expandAchievementToQuests(data.value, achievement.achievementId, nextChoices), achievement.name)
  if (nextAchievement) startAchievementChoice(nextAchievement, remainingQueuedAchievements, nextChoices)
}

function cancelAchievementChoice(): void {
  pendingAchievement.value = null
  pendingAchievementQueue.value = []
  pendingChoiceRules.value = []
  pendingChoiceValues.value = {}
  status.value = 'Ajout du succès annulé'
}

function removeQuest(questId: number): void {
  selectedQuests.value = selectedQuests.value.filter((quest) => quest.questId !== questId)
  status.value = 'Quête retirée'
}

function clearQuests(): void {
  selectedQuests.value = []
  currentEntries.value = []
  currentAlternativeGroups.value = []
  checkedItemIds.value = new Set()
  ownedQuantities.value = {}
  selectedAlternativeOptionKeys.value = {}
  craftPlan.value = null
  craftCheckedKeys.value = new Set()
  craftOpen.value = false
  choiceOpen.value = false
  status.value = 'Liste vidée'
}

async function parseClipboard(): Promise<void> {
  if (!data.value) return
  try {
    let text = ''
    if ('__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core')
      text = await invoke<string>('read_clipboard')
    } else {
      text = await navigator.clipboard.readText()
    }
    const { found, missed } = parseClipboardQuests(data.value, text)
    const existing = new Set(selectedQuests.value.map((quest) => quest.questId))
    const parsedQuests = found.filter((result): result is { kind: 'quest' } & QuestInfo => result.kind === 'quest')
    const parsedAchievements = found.filter((result): result is AchievementInfo => result.kind === 'achievement')
    const additions: QuestInfo[] = []
    const choiceAchievements: AchievementInfo[] = []

    parsedQuests.forEach((quest) => {
      if (existing.has(quest.questId)) return
      additions.push(quest)
      existing.add(quest.questId)
    })

    parsedAchievements.forEach((achievement) => {
      const requiredRules = achievementChoiceRulesFor(data.value!, achievement.achievementId)
      if (requiredRules.length) {
        choiceAchievements.push(achievement)
        return
      }

      expandAchievementToQuests(data.value!, achievement.achievementId).forEach((quest) => {
        if (existing.has(quest.questId)) return
        additions.push(quest)
        existing.add(quest.questId)
      })
    })

    selectedQuests.value = [...selectedQuests.value, ...additions]
    questQuery.value = ''

    if (choiceAchievements.length) {
      if (activeChoiceRule.value) {
        pendingAchievementQueue.value = [...pendingAchievementQueue.value, ...choiceAchievements]
      } else {
        startAchievementChoice(choiceAchievements[0], choiceAchievements.slice(1))
      }
      return
    }

    const sourceSummary = parsedAchievements.length
      ? `${additions.length} quêtes ajoutées depuis ${parsedQuests.length} quête(s) et ${parsedAchievements.length} succès`
      : `${additions.length} quêtes ajoutées depuis le presse-papier`
    status.value = missed.length ? `${sourceSummary}, ${missed.length} lignes ignorées` : sourceSummary
  } catch {
    status.value = 'Lecture du presse-papier indisponible'
  }
}

async function computeItems(): Promise<void> {
  if (!data.value || !selectedQuests.value.length) {
    currentEntries.value = []
    currentAlternativeGroups.value = []
    checkedItemIds.value = new Set()
    ownedQuantities.value = {}
    selectedAlternativeOptionKeys.value = {}
    craftPlan.value = null
    craftCheckedKeys.value = new Set()
    craftOpen.value = false
    choiceOpen.value = false
    status.value = data.value ? 'Ajoute au moins une quête' : 'Chargement des données locales...'
    return
  }
  loading.value = true
  try {
    const neededItemIds = [
      ...selectedQuests.value.flatMap((quest) => quest.needItems),
      ...alternativeGroupItemIds(selectedQuests.value),
    ]
    await ensureItems(data.value, neededItemIds, (message) => {
      status.value = message
    })
    currentEntries.value = buildBaseEntries(data.value, selectedQuests.value)
    currentAlternativeGroups.value = buildAlternativeGroups(data.value, selectedQuests.value)
    checkedItemIds.value = new Set()
    ownedQuantities.value = {}
    selectedAlternativeOptionKeys.value = {}
    craftPlan.value = null
    craftCheckedKeys.value = new Set()
    craftOpen.value = false
    choiceOpen.value = currentAlternativeGroups.value.length > 0
    status.value = `${currentEntries.value.length} items et ${currentAlternativeGroups.value.length} choix agrégés depuis ${selectedQuests.value.length} quêtes`
  } catch (error) {
    status.value = error instanceof Error ? `Erreur items : ${error.message}` : 'Erreur items'
  } finally {
    loading.value = false
  }
}

function collectCraftPlanItemIds(plan: CraftPlan): number[] {
  return [
    ...plan.direct_crafts,
    ...plan.sub_crafts,
    ...plan.craft_resources,
    ...plan.base_direct,
    ...plan.excluded,
  ].map((line) => line.item_id)
}

async function prepareCraftPlan(): Promise<void> {
  if (!data.value) return
  if (unresolvedAlternativeGroups.value.length) {
    const names = unresolvedAlternativeGroups.value.slice(0, 3).map((group) => group.label).join(', ')
    const suffix = unresolvedAlternativeGroups.value.length > 3 ? ` et ${unresolvedAlternativeGroups.value.length - 3} autre(s)` : ''
    status.value = `Choisis une option pour ${names}${suffix} avant d'ouvrir le plan craft`
    craftOpen.value = false
    choiceOpen.value = true
    return
  }

  const craftEntries = remainingEntries.value
  if (!craftEntries.length) {
    status.value = 'Plan craft : aucun item non coché'
    return
  }
  loading.value = true
  try {
    await ensureItems(data.value, craftEntries.map((entry) => entry.item_id), (message) => {
      status.value = message
    })
    const firstPlan = buildCraftPlan(data.value, craftEntries)
    await ensureItems(data.value, collectCraftPlanItemIds(firstPlan), (message) => {
      status.value = message
    })
    craftPlan.value = buildCraftPlan(data.value, craftEntries)
    craftCheckedKeys.value = new Set()
    craftOpen.value = true
    choiceOpen.value = false
    const totalLines = displayedCraftLines.value.length
    status.value = `Plan craft prêt : ${totalLines} lignes`
  } catch (error) {
    status.value = error instanceof Error ? `Erreur plan craft : ${error.message}` : 'Erreur plan craft'
  } finally {
    loading.value = false
  }
}

async function toggleCraftPlan(): Promise<void> {
  if (craftPlan.value) {
    craftOpen.value = !craftOpen.value
    if (craftOpen.value) choiceOpen.value = false
    return
  }
  await prepareCraftPlan()
}

function toggleChoicePanel(): void {
  if (!currentAlternativeGroups.value.length) return
  choiceOpen.value = !choiceOpen.value
  if (choiceOpen.value) craftOpen.value = false
}

function craftRowState(line: CraftLine): { checked: boolean; covered: number; done: boolean; label: string } {
  const checked = craftLineProgress(line) >= line.quantity
  const covered = craftLineCovered(line)
  const progress = craftLineProgress(line)
  const label = progress > 0 && progress < line.quantity ? `${progress}/${line.quantity} x ${line.name}` : `${line.quantity} x ${line.name}`
  return { checked, covered, done: checked, label }
}

async function reloadData(): Promise<void> {
  loading.value = true
  status.value = 'Chargement des données locales...'
  try {
    data.value = await loadQuestPlannerData()
    await ensureVisibleCachedImageUrls()
    status.value = `Données locales chargées : ${questCount.value} quêtes, ${achievementCount.value} succès, ${itemCount.value} items, ${recipeCount.value} recettes`
    if (!isSmokeMode()) checkLocalDataStatus()
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Impossible de charger les données locales'
  } finally {
    loading.value = false
  }
}

function isForceFullSyncRequested(): boolean {
  try {
    if (localStorage.getItem(FORCE_FULL_SYNC_KEY) === '1') return true
  } catch {
    // Fall back to the URL flag below.
  }
  return new URLSearchParams(window.location.search).get(FORCE_FULL_SYNC_PARAM) === '1'
}

function clearForceFullSyncRequest(): void {
  try {
    localStorage.removeItem(FORCE_FULL_SYNC_KEY)
  } catch {
    // Best effort only.
  }
  const url = new URL(window.location.href)
  if (url.searchParams.has(FORCE_FULL_SYNC_PARAM)) {
    url.searchParams.delete(FORCE_FULL_SYNC_PARAM)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
}

function resetSyncProgress(phase: string): void {
  if (syncHideTimer) {
    window.clearTimeout(syncHideTimer)
    syncHideTimer = undefined
  }
  syncTasks.value = createSyncTasks()
  syncStartedAt.value = Date.now()
  syncUpdatedAt.value = Date.now()
  syncMeasuredSpeed.value = 0
  syncExternalWait.value = false
  syncSpeedSamples = [{ at: syncStartedAt.value, bytesDone: 0 }]
  syncPhase.value = phase
  syncVisible.value = true
}

function completeSyncProgress(phase: string, hideDelay = 900): void {
  syncPhase.value = phase
  syncUpdatedAt.value = Date.now()
  if (syncHideTimer) window.clearTimeout(syncHideTimer)
  syncHideTimer = window.setTimeout(() => {
    syncVisible.value = false
    syncExternalWait.value = false
    syncHideTimer = undefined
  }, hideDelay)
}

function recordSyncSpeedSample(): void {
  const now = Date.now()
  const bytesDone = syncTotals.value.bytesDone
  syncSpeedSamples.push({ at: now, bytesDone })
  syncSpeedSamples = syncSpeedSamples.filter((sample) => now - sample.at <= 15_000)
  const first = syncSpeedSamples[0]
  const last = syncSpeedSamples[syncSpeedSamples.length - 1]
  if (!first || !last || last.at <= first.at || last.bytesDone <= first.bytesDone) {
    syncMeasuredSpeed.value = 0
    return
  }
  syncMeasuredSpeed.value = (last.bytesDone - first.bytesDone) / ((last.at - first.at) / 1000)
}

function updateSyncTask(key: SyncTaskKey, patch: Partial<Omit<SyncTaskState, 'key' | 'label'>>): void {
  syncTasks.value = {
    ...syncTasks.value,
    [key]: {
      ...syncTasks.value[key],
      ...patch,
    },
  }
  syncUpdatedAt.value = Date.now()
  recordSyncSpeedSample()
}

function isSyncTaskKey(key: string): key is SyncTaskKey {
  return key === 'items' || key === 'recipes' || key === 'itemSets' || key === 'characteristics' || key === 'images' || key === 'statIcons'
}

function seedSyncProgress(info: DatabaseStatus, needsDataSync: boolean): void {
  if (needsDataSync) {
    updateSyncTask('items', { done: 0, total: info.remoteItemTotal, bytesDone: 0 })
    updateSyncTask('recipes', { done: 0, total: info.remoteRecipeTotal, bytesDone: 0 })
    updateSyncTask('itemSets', { done: 0, total: info.remoteItemSetTotal, bytesDone: 0 })
    updateSyncTask('characteristics', { done: 0, total: info.remoteCharacteristicTotal, bytesDone: 0 })
  }
  const estimatedImageTotal = info.missingImageGroups || (needsDataSync ? info.remoteItemTotal : 0)
  if (estimatedImageTotal > 0) {
    updateSyncTask('images', {
      done: 0,
      total: estimatedImageTotal,
      bytesDone: 0,
      bytesTotal: estimatedImageTotal * ESTIMATED_IMAGE_BYTES,
    })
  }
  if (needsDataSync || info.missingCharacteristicIcons > 0) {
    updateSyncTask('statIcons', {
      done: 0,
      total: info.missingCharacteristicIcons,
      bytesDone: 0,
    })
  }
}

function handleSyncProgress(event: QuestSyncProgressEvent | string): void {
  if (typeof event === 'string') {
    syncPhase.value = event
    status.value = event
    syncUpdatedAt.value = Date.now()
    return
  }
  if (event.kind === 'message') {
    syncPhase.value = event.message
    status.value = event.message
    syncUpdatedAt.value = Date.now()
    return
  }
  if (event.kind === 'images') {
    updateSyncTask('images', {
      done: event.done,
      total: event.total,
      bytesDone: event.bytesDone,
      bytesTotal: event.bytesTotal,
    })
    status.value = `Images ${formatQuantity(event.done)} / ${formatQuantity(event.total)}`
    return
  }
  if (event.kind === 'statIcons') {
    updateSyncTask('statIcons', {
      done: event.done,
      total: event.total,
      bytesDone: event.bytesDone,
      bytesTotal: event.bytesTotal,
    })
    status.value = `Icônes stats ${formatQuantity(event.done)} / ${formatQuantity(event.total)}`
    return
  }
  if (!isSyncTaskKey(event.endpoint)) return
  updateSyncTask(event.endpoint, {
    done: event.done,
    total: event.total,
    bytesDone: event.bytesDone,
  })
  status.value = `${event.label || syncTaskLabels[event.endpoint]} ${formatQuantity(event.done)} / ${formatQuantity(event.total)}`
}

function seedSharedSyncStatus(event: any): void {
  const remote = event.remote || {}
  if (remote.items?.total) updateSyncTask('items', { done: 0, total: Number(remote.items.total), bytesDone: 0 })
  if (remote.recipes?.total) updateSyncTask('recipes', { done: 0, total: Number(remote.recipes.total), bytesDone: 0 })
  if (remote.itemSets?.total) updateSyncTask('itemSets', { done: 0, total: Number(remote.itemSets.total), bytesDone: 0 })
  if (remote.characteristics?.total) updateSyncTask('characteristics', { done: 0, total: Number(remote.characteristics.total), bytesDone: 0 })
  if (event.missingImages) {
    updateSyncTask('images', {
      done: 0,
      total: Number(event.missingImages),
      bytesDone: 0,
      bytesTotal: Number(event.missingImages) * ESTIMATED_IMAGE_BYTES,
    })
  }
  if (event.missingStatIcons) updateSyncTask('statIcons', { done: 0, total: Number(event.missingStatIcons), bytesDone: 0 })
  status.value = event.needsSync ? `Mise à jour disponible : ${(event.labels || []).join(', ')}` : 'Base Dofus commune déjà synchronisée'
}

function handleSharedSyncEnginePayload(payload: string): void {
  const event = JSON.parse(payload)
  if (event.kind === 'status') {
    seedSharedSyncStatus(event)
    return
  }
  if (event.kind === 'complete') {
    status.value = event.changed ? 'Base Dofus commune synchronisée' : 'Base Dofus commune déjà synchronisée'
    return
  }
  if (event.kind === 'error') {
    status.value = `Synchronisation impossible : ${event.message}`
    return
  }
  if (event.kind === 'message' || event.kind === 'endpoint' || event.kind === 'images' || event.kind === 'statIcons') {
    handleSyncProgress(event as QuestSyncProgressEvent)
  }
}

async function runSharedSyncEngine(appName: string, force: boolean): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ])
  const unlisten = await listen<string>('shared-sync-event', (event) => {
    try {
      handleSharedSyncEnginePayload(event.payload)
    } catch (error) {
      console.error('[QuestPlanner] shared sync event parse failed', error, event.payload)
    }
  })
  try {
    await invoke('run_shared_sync_engine', { appName, force })
  } finally {
    unlisten()
  }
}

async function waitForSyncDialogPaint(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function externalSyncMessage(lock: SharedSyncLock): string {
  const phase = lock.phase ? ` (${lock.phase})` : ''
  return `${lock.app} met à jour la base Dofus commune${phase}...`
}

async function waitForExternalSharedSync(lock: SharedSyncLock): Promise<void> {
  resetSyncProgress(externalSyncMessage(lock))
  syncExternalWait.value = true
  status.value = externalSyncMessage(lock)
  await waitForSyncDialogPaint()
  let activeLock: SharedSyncLock | null = lock
  while (activeLock) {
    syncPhase.value = externalSyncMessage(activeLock)
    await sleep(2000)
    activeLock = await readSharedSyncLock().catch(() => null)
    if (!activeLock) {
      syncPhase.value = 'Synchronisation commune presque terminée...'
      await sleep(EXTERNAL_SYNC_IDLE_CONFIRM_MS)
      activeLock = await readSharedSyncLock().catch(() => null)
    }
  }
  syncPhase.value = 'Synchronisation commune terminée, vérification locale...'
  data.value = await loadQuestPlannerData()
  await ensureVisibleCachedImageUrls().catch(() => {})
}

async function waitForStartupSharedSync(): Promise<boolean> {
  const lock = await readSharedSyncLock().catch(() => null)
  if (!lock) return false
  await waitForExternalSharedSync(lock)
  completeSyncProgress('Synchronisation commune terminée')
  return true
}

async function withSharedSyncLock<T>(phase: string, action: () => Promise<T>): Promise<T> {
  while (true) {
    const status = await acquireSharedSyncLock('QuestPlanner', phase)
    if (status.acquired) {
      if (syncExternalWait.value) resetSyncProgress(phase)
      syncExternalWait.value = false
      syncPhase.value = phase
      break
    }
    if (status.lock) await waitForExternalSharedSync(status.lock)
    else await sleep(500)
  }
  const heartbeat = window.setInterval(() => {
    void heartbeatSharedSyncLock('QuestPlanner', syncPhase.value || phase).catch(() => {})
  }, 5000)
  try {
    return await action()
  } finally {
    window.clearInterval(heartbeat)
    await releaseSharedSyncLock().catch(() => {})
  }
}

async function checkLocalDataStatus(): Promise<void> {
  if (!data.value) return
  try {
    if (isForceFullSyncRequested()) {
      await syncDatabases(true)
      return
    }
    const info = await checkQuestPlannerDataStatus(data.value)
    if (info.needsSync) {
      status.value = `Mise à jour disponible (${info.missingLabels.join(', ')})`
      const supportLabels = info.missingLabels.filter((label) => label === 'items' || label === 'recettes' || label === 'panoplies')
      const curatedLabels = info.missingLabels.filter((label) => label === 'quêtes' || label === 'succès' || label === 'catégories')
      if (supportLabels.length) {
        await syncDatabases(false, false)
        return
      }
      if (info.missingLabels.includes('images')) {
        await syncImagesOnly()
        return
      }
      if (curatedLabels.length) {
        status.value = `Mise à jour quêtes/succès détectée (${curatedLabels.join(', ')}) : import manuel requis`
      }
      return
    }
    status.value = `Données locales à jour : ${info.localQuestTotal} quêtes, ${info.localAchievementTotal} succès, ${info.localItemTotal} items, ${info.localRecipeTotal} recettes`
  } catch {
    status.value = `Données locales chargées : ${questCount.value} quêtes, ${achievementCount.value} succès, ${itemCount.value} items, ${recipeCount.value} recettes`
  }
}

async function syncImagesOnly(): Promise<void> {
  await syncDatabases(false, false)
}

async function syncDatabases(forceFullSync = false, includeQuestData = false): Promise<void> {
  if (syncing.value) return
  if (!includeQuestData) {
    syncing.value = true
    const phase = forceFullSync ? 'Synchronisation complète forcée...' : 'Synchronisation de la base Dofus commune...'
    resetSyncProgress(phase)
    status.value = phase
    try {
      await waitForSyncDialogPaint()
      await runSharedSyncEngine('QuestPlanner', forceFullSync)
      data.value = await loadQuestPlannerData()
      currentEntries.value = []
      currentAlternativeGroups.value = []
      checkedItemIds.value = new Set()
      ownedQuantities.value = {}
      selectedAlternativeOptionKeys.value = {}
      craftPlan.value = null
      craftCheckedKeys.value = new Set()
      craftOpen.value = false
      choiceOpen.value = false
      await ensureVisibleCachedImageUrls()
      status.value = `Base Dofus commune synchronisée : ${itemCount.value} items, ${recipeCount.value} recettes`
      completeSyncProgress('Synchronisation terminée')
      if (forceFullSync) clearForceFullSyncRequest()
    } catch (error) {
      console.error('[QuestPlanner] shared sync failed', error)
      status.value = `Erreur sync : ${String(error)}`
      completeSyncProgress('Synchronisation impossible, données locales conservées', 1600)
    } finally {
      syncing.value = false
    }
    return
  }
  syncing.value = true
  const phase = forceFullSync
    ? 'Synchronisation complète forcée...'
    : includeQuestData
      ? 'Synchronisation DofusDB...'
      : 'Synchronisation de la base Dofus commune...'
  resetSyncProgress(phase)
  status.value = phase
  try {
    await withSharedSyncLock(phase, async () => {
    data.value = await loadQuestPlannerData()
    if (!forceFullSync && !includeQuestData) {
      const info = await checkQuestPlannerDataStatus(data.value)
      const supportLabels = info.missingLabels.filter((label) => label === 'items' || label === 'recettes' || label === 'panoplies' || label === 'caractéristiques')
      if (!supportLabels.length && !info.missingLabels.includes('images') && !info.missingLabels.includes('icônes de stats')) {
        status.value = 'Base Dofus commune déjà synchronisée'
        completeSyncProgress('Données déjà synchronisées')
        return
      }
      seedSyncProgress(info, supportLabels.length > 0)
      if (!supportLabels.length && info.missingLabels.includes('images')) {
        await syncQuestPlannerImages(data.value, handleSyncProgress)
        await ensureVisibleCachedImageUrls()
      }
      if (!supportLabels.length && info.missingLabels.includes('icônes de stats')) {
        await syncCharacteristicSupportData(handleSyncProgress)
      }
      if (!supportLabels.length && (info.missingLabels.includes('images') || info.missingLabels.includes('icônes de stats'))) {
        status.value = 'Images synchronisées'
        completeSyncProgress('Synchronisation terminée')
        return
      }
    }
    if (forceFullSync) {
      await clearCachedImages()
      await saveFailedCachedImages([])
      cachedImageUrls.value = new Map()
    }
    const synced = await syncQuestPlannerData(handleSyncProgress, data.value || undefined, { includeQuestData })
    data.value = synced
    await syncQuestPlannerImages(synced, handleSyncProgress)
    currentEntries.value = []
    currentAlternativeGroups.value = []
    checkedItemIds.value = new Set()
    ownedQuantities.value = {}
    selectedAlternativeOptionKeys.value = {}
    craftPlan.value = null
    craftCheckedKeys.value = new Set()
    craftOpen.value = false
    choiceOpen.value = false
    await ensureVisibleCachedImageUrls()
    status.value = `Base Dofus commune synchronisée : ${itemCount.value} items, ${recipeCount.value} recettes`
    completeSyncProgress('Synchronisation terminée')
    if (forceFullSync) clearForceFullSyncRequest()
    })
  } catch (error) {
    console.error('[QuestPlanner] sync failed', error)
    const message = error instanceof Error ? error.message : String(error)
    status.value = message.includes('Failed to fetch')
      ? "Sync DofusDB indisponible dans le navigateur local ; elle passe par l'app Tauri"
      : `Erreur sync : ${message}`
    completeSyncProgress('Synchronisation impossible, données locales conservées', 1600)
  } finally {
    syncing.value = false
  }
}

function applyTheme(mode: 'dark' | 'light'): void {
  themeMode.value = mode
  document.documentElement.dataset.theme = mode
  localStorage.setItem('questplanner-theme', mode)
}

function toggleTheme(): void {
  applyTheme(themeMode.value === 'dark' ? 'light' : 'dark')
}

function updateScrollableListClasses(): void {
  document.querySelectorAll<HTMLElement>('.quest-list, .item-list, .choice-list, .craft-list').forEach((list) => {
    const hasScroll = list.scrollHeight > list.clientHeight + 1
    list.classList.toggle('has-scroll', hasScroll)
  })
}

function scheduleScrollableListUpdate(): void {
  if (overflowUpdateFrame) window.cancelAnimationFrame(overflowUpdateFrame)
  void nextTick(() => {
    overflowUpdateFrame = window.requestAnimationFrame(() => {
      overflowUpdateFrame = undefined
      updateScrollableListClasses()
    })
  })
}

function scheduleComputeItems(): void {
  if (autoComputeTimer) window.clearTimeout(autoComputeTimer)
  autoComputeTimer = window.setTimeout(() => {
    autoComputeTimer = undefined
    void computeItems()
  }, 120)
}

watch(
  () => selectedQuests.value.map((quest) => quest.questId).join(','),
  () => {
    if (!data.value) return
    scheduleComputeItems()
  },
)

watch(
  [
    () => selectedQuests.value.length,
    () => displayedEntries.value.length,
    () => currentAlternativeGroups.value.length,
    () => displayedCraftLines.value.length,
    () => craftOpen.value,
    () => choiceOpen.value,
  ],
  scheduleScrollableListUpdate,
  { flush: 'post' },
)

watch(
  () => visibleImageIds().join(','),
  () => {
    void ensureVisibleCachedImageUrls()
  },
  { flush: 'post' },
)

onMounted(async () => {
  window.addEventListener('wheel', handleOwnedInputWheel, { capture: true, passive: false })
  const savedTheme = localStorage.getItem('questplanner-theme')
  applyTheme(savedTheme === 'light' ? 'light' : 'dark')
  const loadedFromSharedSync = !isSmokeMode() && await waitForStartupSharedSync()
  if (loadedFromSharedSync && data.value) {
    loading.value = false
    await ensureVisibleCachedImageUrls()
    status.value = `Données locales chargées : ${questCount.value} quêtes, ${achievementCount.value} succès, ${itemCount.value} items, ${recipeCount.value} recettes`
    await checkLocalDataStatus()
  } else {
    await reloadData()
  }
  await checkAppUpdate()
  scheduleScrollableListUpdate()
})

onBeforeUnmount(() => {
  window.removeEventListener('wheel', handleOwnedInputWheel, { capture: true })
})
</script>

<template>
  <div class="app-shell" @click="questSearchOpen = false">
    <main
      class="workspace"
      :class="{ 'craft-mode': craftOpen && craftPlan, 'choice-mode': choiceOpen }"
      :style="{ '--quest-sidebar-width': questSidebarWidth }"
    >
      <aside class="quest-sidebar glass-surface">
        <section class="quest-top">
          <section class="search-block" @click.stop>
            <q-input
              v-model="questQuery"
              dense
              standout
              clearable
              placeholder="Rechercher une quête ou un succès..."
              :disable="loading"
              @focus="questSearchOpen = true"
              @update:model-value="questSearchOpen = true"
              @keyup.enter="addFirstSearchResult"
            >
              <template #prepend>
                <button
                  class="search-icon-button"
                  type="button"
                  :aria-label="themeMode === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'"
                  @click.stop="toggleTheme"
                >
                  <q-icon :name="themeMode === 'dark' ? 'light_mode' : 'dark_mode'" />
                </button>
                <q-icon name="search" />
              </template>

              <template #append>
                <button
                  class="search-icon-button"
                  type="button"
                  aria-label="Parser"
                  @click.stop="parseClipboard"
                >
                  <q-icon name="content_paste" />
                </button>
                <button
                  class="search-icon-button"
                  type="button"
                  aria-label="Vider"
                  @click.stop="clearQuests"
                >
                  <q-icon name="delete_sweep" />
                </button>
              </template>
            </q-input>

            <div v-if="showSearchResults" class="search-results">
              <div class="search-results-scroll">
                <button
                  v-for="result in searchResults"
                  :key="`${result.kind}:${result.kind === 'quest' ? result.questId : result.achievementId}`"
                  class="result-row"
                  :class="{ selected: searchResultSelected(result), achievement: result.kind === 'achievement' }"
                  type="button"
                  @click="addSearchResult(result)"
                >
                  <q-icon :name="result.kind === 'quest' ? 'assignment' : 'emoji_events'" />
                  <span>{{ result.name }}</span>
                  <small>{{ searchResultMeta(result) }}</small>
                </button>
              </div>
            </div>
          </section>

          <div class="panel-heading">
            <h2>Quêtes sélectionnées</h2>
            <q-badge rounded>{{ formatQuantity(selectedQuests.length) }}</q-badge>
          </div>
        </section>

        <div class="quest-list">
          <p v-if="!selectedQuests.length" class="empty-state">Aucune quête sélectionnée</p>
          <article v-for="quest in selectedQuests" :key="quest.questId" class="quest-chip">
            <button class="quest-link" type="button" @click="openDofusDb('quest', quest.questId)">
              <span>{{ quest.name }}</span>
              <small>niv. {{ quest.levelMin }} · {{ quest.categoryName || 'Sans catégorie' }}</small>
            </button>
            <q-btn dense round flat icon="close" @click="removeQuest(quest.questId)" />
          </article>
        </div>
      </aside>

      <section class="main-board">
        <div class="item-columns" :aria-hidden="craftOpen && Boolean(craftPlan)">
          <article
            v-for="category in CATEGORIES"
            :key="category"
            class="item-column glass-surface"
            :style="{ '--quantity-total-width': quantityTotalWidth(category), '--owned-input-width': quantityInputWidth(category) }"
          >
            <header class="column-heading">
              <h2>{{ categoryTitle(category) }}</h2>
              <q-badge rounded>{{ categoryProgress(category) }}</q-badge>
            </header>

            <div v-if="groupedEntries[category].length" class="item-list">
              <article
                v-for="entry in groupedEntries[category]"
                :key="entry.item_id"
                class="item-row"
                :data-item-id="entry.item_id"
                :class="{ done: isEntryDone(entry) }"
              >
                <input
                  type="checkbox"
                  :checked="isEntryDone(entry)"
                  @change="setItemChecked(entry.item_id, ($event.target as HTMLInputElement).checked)"
                />
                <div class="quantity-control">
                  <input
                    class="owned-input"
                    type="number"
                    min="0"
                    :max="entry.quantity"
                    :value="entryOwned(entry)"
                    data-wheel-kind="entry"
                    :data-item-id="entry.item_id"
                    aria-label="Quantité possédée"
                    @change="changeEntryOwned(entry, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="quantity-total">/ {{ formatQuantity(entry.quantity) }}</span>
                </div>
                <div class="item-card">
                  <button class="item-link" type="button" @click="openDofusDb('object', entry.item_id)">
                    <img v-if="imageUrl(entry.image_path, entry.item_id)" :src="imageUrl(entry.image_path, entry.item_id)" alt="" />
                    <span v-else class="image-fallback">{{ entry.name.slice(0, 1) }}</span>
                    <span class="item-copy">
                      <strong>{{ entry.name }}</strong>
                      <small>{{ entryMeta(entry) }}</small>
                    </span>
                  </button>
                </div>
              </article>

            </div>
            <p v-else class="empty-state">Aucun item</p>
          </article>
        </div>

        <aside class="choice-panel glass-surface" :class="{ open: choiceOpen }">
          <button
            v-if="!choiceOpen"
            class="choice-rail"
            type="button"
            :disabled="!currentAlternativeGroups.length"
            @click="toggleChoicePanel"
          >
            <span class="rail-title">Choix</span>
            <span class="rail-badge">{{ formatQuantity(unresolvedAlternativeGroups.length) }}</span>
          </button>

          <div v-else class="choice-expanded">
            <header class="craft-heading">
              <q-btn dense round flat icon="close" @click="choiceOpen = false" />
              <h2>Items à choisir</h2>
              <q-badge rounded color="primary">{{ formatQuantity(choiceResolvedCount) }}/{{ formatQuantity(choiceTotalCount) }}</q-badge>
            </header>

            <div class="choice-grid">
              <section v-for="category in CATEGORIES" :key="category" class="choice-section">
                <header>
                  <h3>{{ categoryTitle(category) }}</h3>
                  <span>{{ choicePanelProgress(category) }}</span>
                </header>

                <div class="choice-list">
                  <p v-if="!groupedAlternativeGroups[category].length" class="empty-state compact">Aucun choix</p>
                  <article
                    v-for="group in groupedAlternativeGroups[category]"
                    :key="group.group_key"
                    class="alternative-row"
                    :class="{ done: isAlternativeGroupResolved(group) }"
                  >
                    <div class="alternative-card">
                      <header>
                        <span>{{ group.source_quests.join(', ') }}</span>
                      </header>

                      <div class="alternative-options">
                        <template v-for="(option, optionIndex) in group.options" :key="option.option_key">
                          <div v-if="optionIndex > 0" class="alternative-separator"><span>ou</span></div>
                          <div
                            class="alternative-option"
                            :class="{ selected: isAlternativeOptionSelected(group, option.option_key) }"
                          >
                            <button
                              class="alternative-select"
                              type="button"
                              :aria-pressed="isAlternativeOptionSelected(group, option.option_key)"
                              @click="selectAlternativeOption(group.group_key, option.option_key)"
                            >
                              <span aria-hidden="true"></span>
                            </button>
                            <button
                              v-for="item in option.items"
                              :key="`${option.option_key}:${item.item_id}`"
                              class="alternative-item"
                              type="button"
                              @click="openDofusDb('object', item.item_id)"
                            >
                              <img v-if="imageUrl(item.image_path, item.item_id)" :src="imageUrl(item.image_path, item.item_id)" alt="" />
                              <span v-else class="image-fallback">{{ item.name.slice(0, 1) }}</span>
                              <span class="item-copy">
                                <strong>{{ formatQuantity(item.quantity) }} x {{ item.name }}</strong>
                                <small>{{ alternativeItemMeta(item) }}</small>
                              </span>
                            </button>
                          </div>
                        </template>
                      </div>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </div>
        </aside>

        <aside class="craft-panel glass-surface" :class="{ open: craftOpen && craftPlan }">
          <button
            v-if="!craftOpen || !craftPlan"
            class="craft-rail"
            type="button"
            :disabled="!craftTargetCount"
            @click="toggleCraftPlan"
          >
            <span class="rail-title">Plan craft</span>
            <span class="rail-badge">{{ formatQuantity(craftTargetCount) }}</span>
          </button>

          <div v-else class="craft-expanded">
            <header class="craft-heading">
              <q-btn dense round flat icon="close" @click="craftOpen = false" />
              <h2>Plan de craft</h2>
              <q-badge rounded color="primary">{{ formatQuantity(craftCheckedCount) }}/{{ formatQuantity(displayedCraftLines.length) }}</q-badge>
            </header>

            <div v-if="craftPanels.length" class="craft-grid">
              <section
                v-for="section in craftPanels"
                :key="section.key"
                class="craft-section"
                :style="{ '--quantity-total-width': craftQuantityTotalWidth(section.lines), '--owned-input-width': craftQuantityInputWidth(section.lines) }"
              >
                <header>
                  <h3>{{ section.title }}</h3>
                  <span>{{ craftPanelProgress(section) }}</span>
                </header>

                <div class="craft-list">
                  <p v-if="!section.lines.length" class="empty-state compact">Aucun item</p>
                  <article
                    v-for="line in section.lines"
                    :key="line.line_key"
                    class="craft-row"
                    :data-item-id="line.item_id"
                    :data-craft-line-key="line.line_key"
                    :data-progress="craftLineProgress(line)"
                    :data-quantity="line.quantity"
                    :class="{ done: craftRowState(line).done }"
                  >
                    <input
                      type="checkbox"
                      :checked="craftLineChecked(line)"
                      @change="setCraftChecked(line, ($event.target as HTMLInputElement).checked)"
                    />
                    <div class="quantity-control">
                      <input
                        class="owned-input"
                        type="number"
                        min="0"
                        :max="line.quantity"
                        :value="craftLineProgress(line)"
                        data-wheel-kind="craft"
                        :data-line-key="line.line_key"
                        aria-label="Quantité validée"
                        @change="changeCraftOwned(line, Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="quantity-total">/ {{ formatQuantity(line.quantity) }}</span>
                    </div>
                    <div class="item-card">
                      <button class="item-link" type="button" @click="openDofusDb('object', line.item_id)">
                        <img v-if="imageUrl(line.image_path, line.item_id)" :src="imageUrl(line.image_path, line.item_id)" alt="" />
                        <span v-else class="image-fallback">{{ line.name.slice(0, 1) }}</span>
                        <span class="item-copy">
                          <strong>{{ line.name }}</strong>
                          <small>{{ craftMeta(line) }}</small>
                        </span>
                      </button>
                    </div>
                  </article>
                </div>
              </section>
            </div>

            <p v-else class="empty-state">Aucune ligne de craft</p>
          </div>
        </aside>
      </section>
    </main>

    <div v-if="syncVisible" class="sync-dialog catalog-sync-dialog">
      <section class="sync-card sync-progress-card glass-surface" role="status" aria-live="polite">
        <header class="sync-progress-head">
          <div>
            <span>Synchronisation des données DofusDB</span>
            <h2>{{ syncPhase }}</h2>
          </div>
          <strong v-if="!syncExternalWait">{{ syncPercent }}%</strong>
        </header>
        <template v-if="!syncExternalWait">
          <div class="sync-progress-track">
            <span :style="{ width: `${syncPercent}%` }"></span>
          </div>
          <div class="sync-progress-rows">
            <div v-for="task in syncRows" :key="task.key" class="sync-progress-row">
              <span>{{ task.label }}</span>
              <strong>{{ formatQuantity(task.done) }} / {{ formatQuantity(task.total) }}</strong>
            </div>
          </div>
          <div class="sync-progress-details" aria-label="Détails du téléchargement">
            <span v-for="detail in syncDownloadDetails" :key="detail.label">
              {{ detail.label }} :
              <strong>{{ detail.value }}</strong>
            </span>
          </div>
        </template>
        <p v-else>Cette app attend que la synchronisation commune se termine.</p>
      </section>
    </div>

    <div v-if="showAppUpdatePrompt && appUpdate" class="sync-dialog">
      <div class="sync-card glass-surface">
        <h2>Mise à jour nécessaire</h2>
        <p>
          La version {{ appUpdate.version }} est disponible. QuestPlanner doit l'installer maintenant,
          puis l'application redémarre toute seule.
        </p>
        <p v-if="appUpdateProgress" class="update-progress">{{ appUpdateProgress }}</p>
      </div>
    </div>

    <div v-if="activeChoiceRule" class="choice-dialog">
      <div class="choice-card glass-surface">
        <header>
          <div>
            <span class="choice-kicker">Choix requis</span>
            <h2>{{ activeChoiceRule.title }}</h2>
          </div>
          <q-btn dense round flat icon="close" @click="cancelAchievementChoice" />
        </header>
        <p>{{ activeChoiceRule.subtitle }}</p>

        <div class="choice-options" :class="{ many: activeChoiceRule.options.length > 8 }">
          <button
            v-for="option in activeChoiceRule.options"
            :key="option.key"
            class="choice-option"
            :class="option.visualClass"
            type="button"
            @click="selectAchievementOption(option)"
          >
            <span class="choice-visual">
              <img v-if="imageUrl(option.icon)" :src="imageUrl(option.icon)" alt="" />
              <q-icon v-else :name="option.materialIcon || 'route'" />
            </span>
            <span class="choice-copy">
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
              <em>{{ option.questIds.length > 1 ? `${option.questIds.length} quêtes` : '1 quête' }}</em>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
