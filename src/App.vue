<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
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
  syncQuestPlannerData,
  type AchievementChoiceOption,
  type AchievementChoiceRule,
  type AchievementInfo,
  type AlternativeItemGroupEntry,
  type AlternativeItemLine,
  type CraftLine,
  type CraftPlan,
  type ItemEntry,
  type QuestInfo,
  type QuestPlannerData,
  type SearchResult,
} from './questLogic'

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
const selectedQuests = ref<QuestInfo[]>([])
const pendingAchievement = ref<AchievementInfo | null>(null)
const pendingAchievementQueue = ref<AchievementInfo[]>([])
const pendingChoiceRules = ref<AchievementChoiceRule[]>([])
const pendingChoiceValues = ref<Record<number, string>>({})
const currentEntries = ref<ItemEntry[]>([])
const currentAlternativeGroups = ref<AlternativeItemGroupEntry[]>([])
const checkedItemIds = ref<Set<number>>(new Set())
const selectedAlternativeOptionKeys = ref<Record<string, string>>({})
const craftPlan = ref<CraftPlan | null>(null)
const craftCheckedKeys = ref<Set<string>>(new Set())
const craftOpen = ref(false)
const choiceOpen = ref(false)
const appUpdate = shallowRef<AppUpdate | null>(null)
const showAppUpdatePrompt = ref(false)
const checkingAppUpdate = ref(false)
const installingAppUpdate = ref(false)
const appUpdateProgress = ref('')
let autoComputeTimer: number | undefined
let overflowUpdateFrame: number | undefined

const questCount = computed(() => Object.keys(data.value?.quests || {}).length)
const achievementCount = computed(() => Object.keys(data.value?.achievements || {}).length)
const itemCount = computed(() => Object.keys(data.value?.items || {}).length)
const recipeCount = computed(() => Object.keys(data.value?.recipes || {}).length)

const searchResults = computed(() => {
  if (!data.value) return []
  return searchQuestsAndCategories(data.value, questQuery.value, 40)
})

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

const displayedCraftLines = computed(() => craftPanels.value.flatMap((section) => section.lines))
const craftCheckedCount = computed(() => displayedCraftLines.value.filter((line) => craftRowState(line).done).length)

const coveredByItemId = computed(() => {
  const covered = new Map<number, number>()
  const plan = craftPlan.value
  if (!plan) return covered

  craftCheckedKeys.value.forEach((lineKey) => {
    const dependencies = plan.dependencies[lineKey] || {}
    Object.entries(dependencies).forEach(([childId, childQuantity]) => {
      covered.set(Number(childId), (covered.get(Number(childId)) || 0) + Number(childQuantity))
    })
  })

  return covered
})

function imageUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/')) return path
  return path ? `/${path.replace(/\\/g, '/')}` : ''
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
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

async function installAppUpdate(): Promise<void> {
  if (installingAppUpdate.value) return
  if (!appUpdate.value) return
  installingAppUpdate.value = true
  showAppUpdatePrompt.value = true
  appUpdateProgress.value = 'Téléchargement de la mise à jour...'
  let downloaded = 0
  let total: number | undefined
  try {
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
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (error) {
    appUpdateProgress.value = `Mise à jour impossible : ${String(error)}`
    status.value = appUpdateProgress.value
  } finally {
    installingAppUpdate.value = false
  }
}

function setItemChecked(itemId: number, checked: boolean): void {
  const next = new Set(checkedItemIds.value)
  if (checked) next.add(itemId)
  else next.delete(itemId)
  checkedItemIds.value = next
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
  if (checked) next.add(line.line_key)
  else next.delete(line.line_key)
  craftCheckedKeys.value = next
  if (craftLineCompletesBaseItem(line)) {
    setItemChecked(line.item_id, checked)
  }
}

function isChecked(itemId: number): boolean {
  return checkedItemIds.value.has(itemId)
}

function isEntryDone(entry: ItemEntry): boolean {
  return isChecked(entry.item_id)
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
  return `${checked}/${entries.length}`
}

function choicePanelProgress(category: string): string {
  const alternatives = groupedAlternativeGroups.value[category] || []
  const resolved = alternatives.filter((group) => selectedAlternativeOptionKeys.value[group.group_key]).length
  return `${resolved}/${alternatives.length}`
}

function craftPanelProgress(section: { lines: CraftLine[] }): string {
  const checked = section.lines.filter((line) => craftRowState(line).done).length
  return `${checked}/${section.lines.length}`
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
  const isBaseLine = line.line_key.startsWith('direct_crafts:')
    || line.line_key.startsWith('base_direct:')
    || line.line_key.startsWith('excluded:')
  return isBaseLine && displayedEntries.value.some((entry) => entry.item_id === line.item_id)
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
  status.value = `Ajouté : ${quest.name}`
  return true
}

function addQuests(quests: QuestInfo[], sourceLabel: string): void {
  const existing = new Set(selectedQuests.value.map((quest) => quest.questId))
  const additions = quests.filter((quest) => !existing.has(quest.questId))
  selectedQuests.value = [...selectedQuests.value, ...additions]
  questQuery.value = ''
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
  const checked = craftCheckedKeys.value.has(line.line_key)
  const covered = Math.min(coveredByItemId.value.get(line.item_id) || 0, line.quantity)
  const done = checked || covered >= line.quantity
  const label = covered > 0 && !checked ? `${covered}/${line.quantity} x ${line.name}` : `${line.quantity} x ${line.name}`
  return { checked, covered, done, label }
}

async function reloadData(): Promise<void> {
  loading.value = true
  status.value = 'Chargement des données locales...'
  try {
    data.value = await loadQuestPlannerData()
    status.value = `Données locales chargées : ${questCount.value} quêtes, ${achievementCount.value} succès, ${itemCount.value} items, ${recipeCount.value} recettes`
    checkLocalDataStatus()
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Impossible de charger les données locales'
  } finally {
    loading.value = false
  }
}

async function checkLocalDataStatus(): Promise<void> {
  if (!data.value) return
  try {
    const info = await checkQuestPlannerDataStatus(data.value)
    if (info.needsSync) {
      status.value = `Mise à jour disponible (${info.missingLabels.join(', ')})`
      if (isTauriRuntime()) await syncDatabases()
      return
    }
    status.value = `Données locales à jour : ${info.localQuestTotal} quêtes, ${info.localAchievementTotal} succès, ${info.localItemTotal} items, ${info.localRecipeTotal} recettes`
  } catch {
    status.value = `Données locales chargées : ${questCount.value} quêtes, ${achievementCount.value} succès, ${itemCount.value} items, ${recipeCount.value} recettes`
  }
}

async function syncDatabases(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  status.value = 'Synchronisation DofusDB...'
  try {
    const synced = await syncQuestPlannerData((message) => {
      status.value = message
    }, data.value || undefined)
    data.value = synced
    currentEntries.value = []
    currentAlternativeGroups.value = []
    checkedItemIds.value = new Set()
    selectedAlternativeOptionKeys.value = {}
    craftPlan.value = null
    craftCheckedKeys.value = new Set()
    craftOpen.value = false
    choiceOpen.value = false
    status.value = `Données synchronisées : ${questCount.value} quêtes, ${achievementCount.value} succès, ${itemCount.value} items, ${recipeCount.value} recettes`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    status.value = message.includes('Failed to fetch')
      ? "Sync DofusDB indisponible dans le navigateur local ; elle passe par l'app Tauri"
      : `Erreur sync : ${message}`
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

onMounted(async () => {
  const savedTheme = localStorage.getItem('questplanner-theme')
  applyTheme(savedTheme === 'light' ? 'light' : 'dark')
  await reloadData()
  await checkAppUpdate()
  scheduleScrollableListUpdate()
})
</script>

<template>
  <div class="app-shell">
    <main
      class="workspace"
      :class="{ 'craft-mode': craftOpen && craftPlan, 'choice-mode': choiceOpen }"
      :style="{ '--quest-sidebar-width': questSidebarWidth }"
    >
      <aside class="quest-sidebar glass-surface">
        <section class="quest-top">
          <section class="search-block">
            <q-input
              v-model="questQuery"
              dense
              standout
              clearable
              placeholder="Rechercher une quête ou un succès..."
              :disable="loading"
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

            <div v-if="questQuery && searchResults.length" class="search-results">
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
          </section>

          <div class="panel-heading">
            <h2>Quêtes sélectionnées</h2>
            <q-badge rounded>{{ selectedQuests.length }}</q-badge>
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
          <article v-for="category in CATEGORIES" :key="category" class="item-column glass-surface">
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
                <button class="item-card" type="button" @click="openDofusDb('object', entry.item_id)">
                  <img v-if="entry.image_path" :src="imageUrl(entry.image_path)" alt="" />
                  <span v-else class="image-fallback">{{ entry.name.slice(0, 1) }}</span>
                  <span class="item-copy">
                    <strong>{{ entry.quantity }} x {{ entry.name }}</strong>
                    <small>{{ entryMeta(entry) }}</small>
                  </span>
                </button>
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
            <span class="rail-badge">{{ unresolvedAlternativeGroups.length }}</span>
          </button>

          <div v-else class="choice-expanded">
            <header class="craft-heading">
              <q-btn dense round flat icon="close" @click="choiceOpen = false" />
              <h2>Items à choisir</h2>
              <q-badge rounded color="primary">{{ choiceResolvedCount }}/{{ choiceTotalCount }}</q-badge>
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
                              <img v-if="item.image_path" :src="imageUrl(item.image_path)" alt="" />
                              <span v-else class="image-fallback">{{ item.name.slice(0, 1) }}</span>
                              <span class="item-copy">
                                <strong>{{ item.quantity }} x {{ item.name }}</strong>
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
            <span class="rail-badge">{{ craftTargetCount }}</span>
          </button>

          <div v-else class="craft-expanded">
            <header class="craft-heading">
              <q-btn dense round flat icon="close" @click="craftOpen = false" />
              <h2>Plan de craft</h2>
              <q-badge rounded color="primary">{{ craftCheckedCount }}/{{ displayedCraftLines.length }}</q-badge>
            </header>

            <div v-if="craftPanels.length" class="craft-grid">
              <section v-for="section in craftPanels" :key="section.key" class="craft-section">
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
                    :class="{ done: craftRowState(line).done }"
                  >
                    <input
                      type="checkbox"
                      :checked="craftRowState(line).done"
                      @change="setCraftChecked(line, ($event.target as HTMLInputElement).checked)"
                    />
                    <button class="item-card" type="button" @click="openDofusDb('object', line.item_id)">
                      <img v-if="line.image_path" :src="imageUrl(line.image_path)" alt="" />
                      <span v-else class="image-fallback">{{ line.name.slice(0, 1) }}</span>
                      <span class="item-copy">
                        <strong>{{ craftRowState(line).label }}</strong>
                        <small>{{ craftMeta(line) }}</small>
                      </span>
                    </button>
                  </article>
                </div>
              </section>
            </div>

            <p v-else class="empty-state">Aucune ligne de craft</p>
          </div>
        </aside>
      </section>
    </main>

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
              <img v-if="option.icon" :src="imageUrl(option.icon)" alt="" />
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
