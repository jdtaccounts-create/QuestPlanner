<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  achievementChoiceRulesFor,
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
  type CraftLine,
  type CraftPlan,
  type ItemEntry,
  type QuestInfo,
  type QuestPlannerData,
  type SearchResult,
} from './questLogic'

const data = ref<QuestPlannerData | null>(null)
const loading = ref(true)
const syncing = ref(false)
const checkingSync = ref(false)
const updateAvailable = ref(false)
const status = ref('Chargement des données locales...')
const themeMode = ref<'dark' | 'light'>('dark')
const questQuery = ref('')
const selectedQuests = ref<QuestInfo[]>([])
const pendingAchievement = ref<AchievementInfo | null>(null)
const pendingChoiceRules = ref<AchievementChoiceRule[]>([])
const pendingChoiceValues = ref<Record<number, string>>({})
const currentEntries = ref<ItemEntry[]>([])
const checkedItemIds = ref<Set<number>>(new Set())
const craftPlan = ref<CraftPlan | null>(null)
const craftCheckedKeys = ref<Set<string>>(new Set())
const craftOpen = ref(false)
const showSyncConfirm = ref(false)

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

const questSidebarWidth = computed(() => {
  const longestSelectedName = selectedQuests.value.reduce((longest, quest) => Math.max(longest, quest.name.length), 0)
  const longestSearchName = searchResults.value.reduce((longest, result) => Math.max(longest, result.name.length), 0)
  const longestName = Math.max(24, longestSelectedName, longestSearchName)
  return `${Math.min(430, Math.max(322, 150 + longestName * 6.8))}px`
})

const groupedEntries = computed(() => {
  const groups = Object.fromEntries(CATEGORIES.map((category) => [category, [] as ItemEntry[]]))
  currentEntries.value.forEach((entry) => groups[entry.category].push(entry))
  CATEGORIES.forEach((category) => groups[category].sort(compareEntries))
  return groups
})

const remainingEntries = computed(() => currentEntries.value.filter((entry) => !isEntryDone(entry)))

const craftSections = computed(() => {
  const plan = craftPlan.value
  if (!plan) return []
  return [
    { key: 'direct_crafts', title: 'Base à craft', lines: plan.direct_crafts },
    { key: 'sub_crafts', title: 'Sous-crafts', lines: plan.sub_crafts },
    { key: 'craft_resources', title: 'Ressources craft', lines: plan.craft_resources },
    { key: 'base_direct', title: 'Base à obtenir', lines: [...plan.base_direct, ...plan.excluded] },
  ]
})

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

const headerSummary = computed(() => {
  if (loading.value && !data.value) return 'Chargement des données locales...'
  if (!currentEntries.value.length) {
    return data.value
      ? `${questCount.value} quêtes · ${achievementCount.value} succès · ${itemCount.value} items · ${recipeCount.value} recettes`
      : status.value
  }
  return `${currentEntries.value.length} items différents · ${remainingEntries.value.length} restants · ${status.value}`
})

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

async function openDofusDb(kind: 'object' | 'quest' | 'achievement', id: number): Promise<void> {
  const url = `https://dofusdb.fr/database/${kind}/${id}`
  if ('__TAURI_INTERNALS__' in window) {
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

function setItemChecked(itemId: number, checked: boolean): void {
  const next = new Set(checkedItemIds.value)
  if (checked) next.add(itemId)
  else next.delete(itemId)
  checkedItemIds.value = next
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
  const covered = coveredByItemId.value.get(entry.item_id) || 0
  return isChecked(entry.item_id) || covered >= entry.quantity
}

function categoryTitle(category: string): string {
  return category === 'Equipement' ? 'Equipements' : `${category}s`
}

function categoryProgress(category: string): string {
  const entries = groupedEntries.value[category] || []
  const checked = entries.filter((entry) => isEntryDone(entry)).length
  return `${checked}/${entries.length}`
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

function craftMeta(line: CraftLine): string {
  return itemSubtype(line.item_id, line.raw_type)
}

function craftLineCompletesBaseItem(line: CraftLine): boolean {
  if (line.line_key.startsWith('ingredients:')) {
    return currentEntries.value.some((entry) => entry.item_id === line.item_id)
  }
  const isBaseLine = line.line_key.startsWith('direct_crafts:')
    || line.line_key.startsWith('base_direct:')
    || line.line_key.startsWith('excluded:')
  return isBaseLine && currentEntries.value.some((entry) => entry.item_id === line.item_id)
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

function addAchievement(achievement: AchievementInfo): void {
  if (!data.value) return
  const requiredRules = achievementChoiceRulesFor(data.value, achievement.achievementId)
  if (requiredRules.length) {
    pendingAchievement.value = achievement
    pendingChoiceRules.value = requiredRules
    pendingChoiceValues.value = {}
    status.value = `Choix requis pour ${achievement.name}`
    return
  }

  addQuests(expandAchievementToQuests(data.value, achievement.achievementId), achievement.name)
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

  pendingChoiceValues.value = {
    ...pendingChoiceValues.value,
    [rule.achievementId]: option.key,
  }

  const remainingRules = achievementChoiceRulesFor(data.value, pendingAchievement.value.achievementId, pendingChoiceValues.value)
  if (remainingRules.length) {
    pendingChoiceRules.value = remainingRules
    return
  }

  const achievement = pendingAchievement.value
  const choices = pendingChoiceValues.value
  pendingAchievement.value = null
  pendingChoiceRules.value = []
  pendingChoiceValues.value = {}
  addQuests(expandAchievementToQuests(data.value, achievement.achievementId, choices), achievement.name)
}

function cancelAchievementChoice(): void {
  pendingAchievement.value = null
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
  checkedItemIds.value = new Set()
  craftPlan.value = null
  craftCheckedKeys.value = new Set()
  craftOpen.value = false
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
    const additions = found.filter((quest) => !existing.has(quest.questId))
    selectedQuests.value = [...selectedQuests.value, ...additions]
    status.value = missed.length
      ? `${additions.length} quêtes ajoutées, ${missed.length} lignes ignorées`
      : `${additions.length} quêtes ajoutées depuis le presse-papier`
  } catch {
    status.value = 'Lecture du presse-papier indisponible'
  }
}

async function computeItems(): Promise<void> {
  if (!data.value || !selectedQuests.value.length) {
    status.value = 'Ajoute au moins une quête'
    return
  }
  loading.value = true
  try {
    const neededItemIds = selectedQuests.value.flatMap((quest) => quest.needItems)
    await ensureItems(data.value, neededItemIds, (message) => {
      status.value = message
    })
    currentEntries.value = buildBaseEntries(data.value, selectedQuests.value)
    checkedItemIds.value = new Set()
    craftPlan.value = null
    craftCheckedKeys.value = new Set()
    craftOpen.value = false
    status.value = `${currentEntries.value.length} items agrégés depuis ${selectedQuests.value.length} quêtes`
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
  if (!remainingEntries.value.length) {
    status.value = 'Plan craft : aucun item non coché'
    return
  }
  loading.value = true
  try {
    await ensureItems(data.value, remainingEntries.value.map((entry) => entry.item_id), (message) => {
      status.value = message
    })
    const firstPlan = buildCraftPlan(data.value, remainingEntries.value)
    await ensureItems(data.value, collectCraftPlanItemIds(firstPlan), (message) => {
      status.value = message
    })
    craftPlan.value = buildCraftPlan(data.value, remainingEntries.value)
    craftCheckedKeys.value = new Set()
    craftOpen.value = true
    const totalLines = craftSections.value.reduce((total, section) => total + section.lines.length, 0)
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
    return
  }
  await prepareCraftPlan()
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
    updateAvailable.value = info.needsSync
    if (info.needsSync) {
      status.value = `Mise à jour disponible (${info.missingLabels.join(', ')}) : clique sur Sync DofusDB`
      return
    }
    status.value = `Données locales à jour : ${info.localQuestTotal} quêtes, ${info.localAchievementTotal} succès, ${info.localItemTotal} items, ${info.localRecipeTotal} recettes`
  } catch {
    updateAvailable.value = false
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
    })
    data.value = synced
    updateAvailable.value = false
    currentEntries.value = []
    checkedItemIds.value = new Set()
    craftPlan.value = null
    craftCheckedKeys.value = new Set()
    craftOpen.value = false
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

async function requestSyncDatabases(): Promise<void> {
  if (syncing.value || checkingSync.value) return
  if (!data.value) {
    await syncDatabases()
    return
  }

  checkingSync.value = true
  status.value = 'Vérification DofusDB avant synchronisation...'
  try {
    const info = await checkQuestPlannerDataStatus(data.value)
    updateAvailable.value = info.needsSync
    if (info.needsSync) {
      await syncDatabases()
      return
    }
    status.value = 'Données déjà à jour : synchronisation complète inutile'
    showSyncConfirm.value = true
  } catch {
    status.value = 'Vérification impossible : confirme si tu veux forcer la synchronisation'
    showSyncConfirm.value = true
  } finally {
    checkingSync.value = false
  }
}

async function forceSyncDatabases(): Promise<void> {
  showSyncConfirm.value = false
  await syncDatabases()
}

function applyTheme(mode: 'dark' | 'light'): void {
  themeMode.value = mode
  document.documentElement.dataset.theme = mode
  localStorage.setItem('questplanner-theme', mode)
}

function toggleTheme(): void {
  applyTheme(themeMode.value === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  const savedTheme = localStorage.getItem('questplanner-theme')
  applyTheme(savedTheme === 'light' ? 'light' : 'dark')
  reloadData()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar glass-surface">
      <div>
        <h1>QuestPlanner</h1>
        <p><span class="status-dot" :class="{ warn: updateAvailable }"></span>{{ headerSummary }}</p>
      </div>
      <div class="toolbar">
        <q-btn flat dense icon="refresh" label="Recharger" :loading="loading" @click="reloadData" />
        <q-btn
          :flat="!updateAvailable"
          :unelevated="updateAvailable"
          dense
          icon="sync"
          label="Sync DofusDB"
          :color="updateAvailable ? 'warning' : undefined"
          :loading="syncing || checkingSync"
          @click="requestSyncDatabases"
        />
        <q-btn color="primary" unelevated icon="inventory_2" label="Chercher les items" @click="computeItems" />
        <q-btn
          color="secondary"
          unelevated
          icon="construction"
          label="Plan craft"
          @click="toggleCraftPlan"
        />
        <q-btn round flat :icon="themeMode === 'dark' ? 'light_mode' : 'dark_mode'" @click="toggleTheme" />
      </div>
    </header>

    <main
      class="workspace"
      :class="{ 'craft-mode': craftOpen && craftPlan }"
      :style="{ '--quest-sidebar-width': questSidebarWidth }"
    >
      <aside class="quest-sidebar glass-surface">
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
              <q-icon name="search" />
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

        <section class="selected-block">
          <div class="panel-heading">
            <h2>Quêtes sélectionnées</h2>
            <q-badge rounded color="secondary">{{ selectedQuests.length }}</q-badge>
          </div>

          <div class="selected-actions">
            <q-btn dense flat icon="content_paste" label="Parser" @click="parseClipboard" />
            <q-btn dense flat icon="delete_sweep" label="Vider" @click="clearQuests" />
          </div>

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
        </section>
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

        <aside class="craft-panel glass-surface" :class="{ open: craftOpen && craftPlan }">
          <button
            v-if="!craftOpen || !craftPlan"
            class="craft-rail"
            type="button"
            @click="toggleCraftPlan"
          >
            <span class="rail-title">Plan craft</span>
            <span class="rail-badge">{{ remainingEntries.length }}</span>
          </button>

          <div v-else class="craft-expanded">
            <header class="craft-heading">
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

    <div v-if="showSyncConfirm" class="sync-dialog">
      <div class="sync-card glass-surface">
        <h2>Synchronisation déjà à jour</h2>
        <p>
          La base locale contient déjà autant d'items, recettes et quêtes que DofusDB.
          Relancer une synchronisation complète peut prendre du temps.
        </p>
        <div class="sync-actions">
          <q-btn flat label="Annuler" @click="showSyncConfirm = false" />
          <q-btn color="primary" unelevated label="Forcer la sync" :loading="syncing" @click="forceSyncDatabases" />
        </div>
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
