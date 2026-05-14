import { loadStoredQuestPlannerData, saveStoredQuestPlannerData } from './questStorage'

export const CATEGORIES = ['Equipement', 'Consommable', 'Ressource'] as const
const API_URL = 'https://api.dofusdb.fr'
const PAGE_LIMIT = 50
const PAGE_CONCURRENCY = 8

export type ItemCategory = (typeof CATEGORIES)[number]

export interface CachedQuest {
  id: number
  name: string
  slug?: string
  name_norm?: string
  slug_norm?: string
  compact?: string
  level_min?: number
  category_id?: number
  category_name?: string
  need_items?: number[]
  need_quantities?: number[]
  need_quests?: number[]
  craft_targets?: number[]
}

export interface QuestInfo {
  questId: number
  name: string
  slug: string
  levelMin: number
  categoryId: number
  categoryName: string
  needItems: number[]
  needQuantities: number[]
  needQuests: number[]
  craftTargets: number[]
  score: number
}

export interface CachedItem {
  id: number
  name?: string
  raw_type?: string
  category?: string
  type_id?: number | null
  type_name?: string
  item_type_category_id?: number | null
  image_url?: string
  image_path?: string
}

export interface Recipe {
  result_id: number
  ingredient_ids: number[]
  quantities: number[]
}

export interface ItemEntry {
  item_id: number
  quantity: number
  name: string
  category: ItemCategory
  raw_type: string
  image_url: string
  image_path: string
  source: string
  source_quests: string[]
  order: number
}

export interface CraftLine {
  line_key: string
  item_id: number
  quantity: number
  name: string
  raw_type: string
  image_path: string
  meta: string
}

export interface CraftPlan {
  direct_crafts: CraftLine[]
  sub_crafts: CraftLine[]
  craft_resources: CraftLine[]
  base_direct: CraftLine[]
  excluded: CraftLine[]
  dependencies: Record<string, Record<number, number>>
  targets: number
}

export interface QuestPlannerData {
  quests: Record<string, CachedQuest>
  categories: Record<string, { id: number; name: string; name_norm?: string; compact?: string }>
  items: Record<string, CachedItem>
  recipes: Record<string, Recipe | null>
  exclusions: {
    item_type_category_ids?: number[]
    item_type_ids?: number[]
    raw_types?: string[]
    item_ids?: number[]
  }
  metadata: Record<string, unknown>
}

export interface DatabaseStatus {
  needsSync: boolean
  remoteQuestTotal: number
  localQuestTotal: number
  remoteQuestCategoryTotal: number
  localQuestCategoryTotal: number
  remoteItemTotal: number
  localItemTotal: number
  remoteRecipeTotal: number
  localRecipeTotal: number
  missingLabels: string[]
}

const EXCLUDED_ITEM_TYPE_CATEGORY_IDS = new Set([4])
const EXCLUDED_ITEM_TYPE_IDS = new Set([80])
const EXCLUDED_LEGACY_RAW_TYPES = new Set([
  'Bénédiction',
  'Bonus de jeu de rôle',
  'Malédiction',
  'Mutation',
  'Suiveur',
])
let bundledItemsCache: Record<string, CachedItem> | null = null

export function normalizeText(value: string): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function compactText(value: string): string {
  return normalizeText(value).replace(/\s/g, '')
}

export function normalizeItemCategory(rawType = ''): ItemCategory {
  if (rawType === 'Ressource' || rawType === 'Consommable') {
    return rawType
  }
  return 'Equipement'
}

export function questInfoFromCache(rawQuest: CachedQuest): QuestInfo {
  return {
    questId: Number(rawQuest.id),
    name: rawQuest.name || `Quête ${rawQuest.id}`,
    slug: rawQuest.slug || '',
    levelMin: Number(rawQuest.level_min || 0),
    categoryId: Number(rawQuest.category_id || 0),
    categoryName: rawQuest.category_name || '',
    needItems: (rawQuest.need_items || []).map(Number),
    needQuantities: (rawQuest.need_quantities || []).map(Number),
    needQuests: (rawQuest.need_quests || []).map(Number),
    craftTargets: (rawQuest.craft_targets || []).map(Number),
    score: 0,
  }
}

export function questScore(queryNorm: string, quest: QuestInfo): number {
  const nameNorm = normalizeText(quest.name)
  const slugNorm = normalizeText(quest.slug)
  const queryCompact = queryNorm.replace(/\s/g, '')
  const nameCompact = nameNorm.replace(/\s/g, '')

  if (queryNorm === nameNorm || queryNorm === slugNorm) return 1.2
  if (nameNorm.startsWith(queryNorm) || slugNorm.startsWith(queryNorm)) return 1.05
  if (nameNorm.includes(queryNorm) || slugNorm.includes(queryNorm)) return 0.92
  if (queryCompact && nameCompact.includes(queryCompact)) return 0.88

  const tokens = queryNorm.split(' ').filter(Boolean)
  if (!tokens.length) return 0
  const matched = tokens.filter((token) => nameNorm.includes(token) || slugNorm.includes(token)).length
  return matched / tokens.length
}

export function searchQuestsAndCategories(data: QuestPlannerData, query: string, limit = 80): QuestInfo[] {
  const queryNorm = normalizeText(query)
  if (!queryNorm) return []

  const scoredById = new Map<number, QuestInfo>()
  Object.values(data.quests).forEach((rawQuest) => {
    const quest = questInfoFromCache(rawQuest)
    const score = questScore(queryNorm, quest)
    if (score >= 0.35) {
      scoredById.set(quest.questId, { ...quest, score })
    }
  })

  Object.values(data.categories).forEach((category) => {
    const nameNorm = category.name_norm || normalizeText(category.name)
    const categoryCompact = category.compact || compactText(category.name)
    const queryCompact = queryNorm.replace(/\s/g, '')
    const score =
      queryNorm === nameNorm
        ? 1.2
        : nameNorm.startsWith(queryNorm)
          ? 1.05
          : nameNorm.includes(queryNorm)
            ? 0.98
            : queryCompact && categoryCompact.includes(queryCompact)
              ? 0.95
              : 0

    if (score < 0.7) return

    Object.values(data.quests).forEach((rawQuest) => {
      if (Number(rawQuest.category_id || 0) !== Number(category.id)) return
      const quest = questInfoFromCache(rawQuest)
      const existing = scoredById.get(quest.questId)
      const candidate = { ...quest, categoryName: category.name, score: Math.max(score, 0.95) }
      if (!existing || candidate.score > existing.score) {
        scoredById.set(quest.questId, candidate)
      }
    })
  })

  return Array.from(scoredById.values())
    .sort((a, b) => b.score - a.score || a.levelMin - b.levelMin || a.name.localeCompare(b.name, 'fr'))
    .slice(0, limit)
}

export function splitQuestLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const rawLines = lines.length <= 2 ? lines.flatMap((line) => line.split(/[;•]+/)) : lines
  const seen = new Set<string>()

  return rawLines
    .map((line) =>
      line
        .replace(/^\s*[-*•]+/, '')
        .replace(/^\s*(?:\d+[\).\-\s]+|[☐☑✓]+)/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => {
      if (line.length < 3) return false
      const norm = normalizeText(line)
      if (seen.has(norm)) return false
      seen.add(norm)
      return true
    })
}

export function parseClipboardQuests(data: QuestPlannerData, text: string): { found: QuestInfo[]; missed: string[] } {
  const found: QuestInfo[] = []
  const missed: string[] = []
  const seen = new Set<number>()

  splitQuestLines(text).forEach((line) => {
    const quest = searchQuestsAndCategories(data, line, 1)[0]
    if (quest && quest.score >= 0.7 && !seen.has(quest.questId)) {
      found.push(quest)
      seen.add(quest.questId)
    } else if (!quest) {
      missed.push(line)
    }
  })

  return { found, missed }
}

function itemImagePath(item: CachedItem): string {
  const imagePath = item.image_path || ''
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath
  }
  return imagePath.replace(/\\/g, '/')
}

function makeItemEntry(
  itemId: number,
  quantity: number,
  item: CachedItem | undefined,
  source: string,
  sourceQuests: string[],
  order = 0,
): ItemEntry {
  const rawType = item?.raw_type || 'Equipement'
  const sourceCount = new Set(sourceQuests).size
  return {
    item_id: itemId,
    quantity,
    name: item?.name || `Item ${itemId}`,
    category: normalizeItemCategory(item?.category || rawType),
    raw_type: rawType,
    image_url: item?.image_url || '',
    image_path: item ? itemImagePath(item) : '',
    source: `${source} · ${sourceCount} ${sourceCount > 1 ? 'quêtes' : 'quête'}`,
    source_quests: [...new Set(sourceQuests)].sort((a, b) => a.localeCompare(b, 'fr')),
    order,
  }
}

function exclusionNumberSet(values: unknown): Set<number> {
  return new Set(Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [])
}

export function isItemExcluded(item: CachedItem | undefined, data: QuestPlannerData): boolean {
  if (!item) return false

  const excludedItemIds = exclusionNumberSet(data.exclusions.item_ids)
  if (excludedItemIds.has(Number(item.id))) return true

  const categoryIds = new Set([
    ...EXCLUDED_ITEM_TYPE_CATEGORY_IDS,
    ...exclusionNumberSet(data.exclusions.item_type_category_ids),
  ])
  if (item.item_type_category_id != null && categoryIds.has(Number(item.item_type_category_id))) return true

  const typeIds = new Set([...EXCLUDED_ITEM_TYPE_IDS, ...exclusionNumberSet(data.exclusions.item_type_ids)])
  if (item.type_id != null && typeIds.has(Number(item.type_id))) return true

  const rawTypes = new Set([...EXCLUDED_LEGACY_RAW_TYPES, ...(data.exclusions.raw_types || [])])
  return rawTypes.has(item.raw_type || '')
}

function isRecipeExcluded(item: CachedItem | undefined, data: QuestPlannerData): boolean {
  return isItemExcluded(item, data) || normalizeText(item?.name || '').includes('eklame')
}

export function buildBaseEntries(data: QuestPlannerData, quests: QuestInfo[]): ItemEntry[] {
  const totals = new Map<number, number>()
  const sources = new Map<number, string[]>()
  const firstOrder = new Map<number, number>()

  quests.forEach((quest, questIndex) => {
    quest.needItems.forEach((itemId, index) => {
      const quantity = Number(quest.needQuantities[index] || 0)
      totals.set(itemId, (totals.get(itemId) || 0) + quantity)
      sources.set(itemId, [...(sources.get(itemId) || []), quest.name])
      if (!firstOrder.has(itemId)) firstOrder.set(itemId, questIndex + 1)
    })
  })

  return Array.from(totals.entries())
    .filter(([itemId]) => !isItemExcluded(data.items[String(itemId)], data))
    .map(([itemId, quantity]) =>
      makeItemEntry(itemId, quantity, data.items[String(itemId)], 'Demandé par les quêtes', sources.get(itemId) || [], firstOrder.get(itemId) || 0),
    )
    .sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.order - b.order || a.name.localeCompare(b.name, 'fr'))
}

function craftLines(quantities: Map<number, number>, data: QuestPlannerData, kind: string, meta: string): CraftLine[] {
  return Array.from(quantities.entries())
    .map(([itemId, quantity]) => {
      const item = data.items[String(itemId)]
      const rawType = item?.raw_type || ''
      return {
        line_key: `${kind}:${itemId}`,
        item_id: itemId,
        quantity,
        name: item?.name || `Item ${itemId}`,
        raw_type: rawType,
        image_path: item ? itemImagePath(item) : '',
        meta: rawType ? `${meta} · ${rawType}` : meta,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

function addQuantity(map: Map<number, number>, itemId: number, quantity: number): void {
  map.set(itemId, (map.get(itemId) || 0) + quantity)
}

export function buildCraftPlan(data: QuestPlannerData, entries: ItemEntry[]): CraftPlan {
  const directCrafts = new Map<number, number>()
  const subCrafts = new Map<number, number>()
  const craftResources = new Map<number, number>()
  const baseDirect = new Map<number, number>()
  const excluded = new Map<number, number>()
  const dependencies = new Map<string, Map<number, number>>()

  const recipeFor = (itemId: number): Recipe | null => data.recipes[String(itemId)] || null

  const addDependency = (parentKey: string, childId: number, quantity: number): void => {
    if (!dependencies.has(parentKey)) dependencies.set(parentKey, new Map())
    addQuantity(dependencies.get(parentKey)!, childId, quantity)
  }

  const expand = (itemId: number, quantity: number, depth: number, stack: number[] = []): Map<number, number> => {
    const item = data.items[String(itemId)]
    if (isRecipeExcluded(item, data) || isItemExcluded(item, data)) {
      addQuantity(excluded, itemId, quantity)
      return new Map()
    }

    if (stack.includes(itemId)) {
      addQuantity(baseDirect, itemId, quantity)
      return new Map()
    }

    const recipe = recipeFor(itemId)
    if (!recipe) {
      addQuantity(depth === 0 ? baseDirect : craftResources, itemId, quantity)
      return new Map()
    }

    const parentKey = `${depth === 0 ? 'direct_crafts' : 'sub_crafts'}:${itemId}`
    addQuantity(depth === 0 ? directCrafts : subCrafts, itemId, quantity)
    const descendants = new Map<number, number>()
    const nextStack = [...stack, itemId]

    recipe.ingredient_ids.forEach((ingredientIdRaw, index) => {
      const ingredientId = Number(ingredientIdRaw)
      const requiredQuantity = quantity * Number(recipe.quantities[index] || 0)
      addQuantity(descendants, ingredientId, requiredQuantity)
      expand(ingredientId, requiredQuantity, depth + 1, nextStack).forEach((childQuantity, childId) => {
        addQuantity(descendants, childId, childQuantity)
      })
    })

    descendants.forEach((childQuantity, childId) => addDependency(parentKey, childId, childQuantity))
    return descendants
  }

  entries.forEach((entry) => expand(entry.item_id, entry.quantity, 0))

  return {
    direct_crafts: craftLines(directCrafts, data, 'direct_crafts', 'Item de la liste de base à craft'),
    sub_crafts: craftLines(subCrafts, data, 'sub_crafts', 'Sous-craft'),
    craft_resources: craftLines(craftResources, data, 'craft_resources', 'Ressource utile aux crafts'),
    base_direct: craftLines(baseDirect, data, 'base_direct', 'Item de la liste de base à obtenir'),
    excluded: craftLines(excluded, data, 'excluded', 'Recette exclue'),
    dependencies: Object.fromEntries(
      Array.from(dependencies.entries()).map(([itemId, childQuantities]) => [
        itemId,
        Object.fromEntries(Array.from(childQuantities.entries()).sort((a, b) => a[0] - b[0])),
      ]),
    ),
    targets: entries.length,
  }
}

export async function loadQuestPlannerData(): Promise<QuestPlannerData> {
  const stored = await loadStoredQuestPlannerData().catch(() => null)
  if (stored) return stored

  const [quests, categories, items, recipes, exclusions, metadata] = await Promise.all([
    fetch('/data/quests.json').then((response) => response.json()),
    fetch('/data/quest_categories.json').then((response) => response.json()),
    fetch('/data/items.json').then((response) => response.json()),
    fetch('/data/recipes.json').then((response) => response.json()),
    fetch('/data/item_exclusions.json').then((response) => response.json()),
    fetch('/data/metadata.json').then((response) => response.json()),
  ])

  return { quests, categories, items, recipes, exclusions, metadata }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function apiGet(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(`${API_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const text = await invoke<string>('http_get', { url: url.toString() })
    return JSON.parse(text)
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`DofusDB ${response.status} ${response.statusText}`)
  return response.json()
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function runNext(): Promise<void> {
    const index = cursor
    cursor += 1
    if (index >= items.length) return
    results[index] = await worker(items[index], index)
    await runNext()
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
  )

  return results
}

async function fetchPaginated(
  path: string,
  limit: number,
  label: string,
  progress?: (message: string) => void,
): Promise<any[]> {
  const firstPage = await apiGet(path, { $limit: limit, $skip: 0 })
  const total = Number(firstPage.total || 0)
  const pageLimit = Number(firstPage.limit || limit)
  const rows = [...(firstPage.data || [])]
  progress?.(`${label} ${Math.min(rows.length, total)}/${total}`)

  if (rows.length >= total || !rows.length) return rows

  const skips = []
  for (let skip = pageLimit; skip < total; skip += pageLimit) {
    skips.push(skip)
  }

  await mapWithConcurrency(skips, PAGE_CONCURRENCY, async (skip) => {
    const page = await apiGet(path, { $limit: limit, $skip: skip })
    const data = page.data || []
    rows.push(...data)
    progress?.(`${label} ${Math.min(rows.length, total)}/${total}`)
    return data.length
  })

  return rows
}

function rawLocaleValue(raw: any, key: string, fallback: string): string {
  return raw?.[key]?.fr || raw?.[key]?.en || fallback
}

function itemNeedsRepair(item: CachedItem | undefined, itemId: number): boolean {
  return !item || !item.name || item.name === `Item ${itemId}` || (!item.raw_type && !item.category)
}

async function loadBundledItems(): Promise<Record<string, CachedItem>> {
  if (bundledItemsCache) return bundledItemsCache
  try {
    bundledItemsCache = await fetch('/data/items.json').then((response) => response.json())
  } catch {
    bundledItemsCache = {}
  }
  return bundledItemsCache || {}
}

async function fetchItemById(itemId: number): Promise<CachedItem | null> {
  try {
    const byQuery = await apiGet('/items', { id: itemId })
    const rawItem = Array.isArray(byQuery?.data) ? byQuery.data[0] : null
    const normalized = normalizeApiItem(rawItem)
    if (normalized) return normalized
  } catch {
    // DofusDB has exposed both query and direct item endpoint shapes.
  }

  try {
    return normalizeApiItem(await apiGet(`/items/${itemId}`))
  } catch {
    return null
  }
}

export async function ensureItems(
  data: QuestPlannerData,
  itemIds: Iterable<number>,
  progress?: (message: string) => void,
): Promise<boolean> {
  const uniqueIds = Array.from(new Set(Array.from(itemIds).map(Number).filter(Number.isFinite)))
  const missingIds = uniqueIds.filter((itemId) => itemNeedsRepair(data.items[String(itemId)], itemId))
  if (!missingIds.length) return false

  let changed = false
  const bundledItems = await loadBundledItems()

  for (const itemId of missingIds) {
    const bundled = bundledItems[String(itemId)]
    if (bundled && !itemNeedsRepair(bundled, itemId)) {
      data.items[String(itemId)] = bundled
      changed = true
    }
  }

  const stillMissing = missingIds.filter((itemId) => itemNeedsRepair(data.items[String(itemId)], itemId))
  for (const [index, itemId] of stillMissing.entries()) {
    progress?.(`Récupération item ${index + 1}/${stillMissing.length} : ${itemId}`)
    const item = await fetchItemById(itemId)
    if (item && !itemNeedsRepair(item, itemId)) {
      data.items[String(itemId)] = item
      changed = true
    }
  }

  if (changed) {
    data.metadata = {
      ...data.metadata,
      item_total: Object.keys(data.items).length,
      last_item_repair: new Date().toISOString(),
    }
    await saveStoredQuestPlannerData(data)
  }

  return changed
}

function normalizeQuestCategory(rawCategory: any): { id: number; name: string; name_norm: string; compact: string; order: number } | null {
  const id = rawCategory?.id
  if (id == null) return null
  const name = rawLocaleValue(rawCategory, 'name', `Catégorie ${id}`)
  return {
    id: Number(id),
    name,
    name_norm: normalizeText(name),
    compact: compactText(name),
    order: Number(rawCategory.order || 0),
  }
}

function extractCraftTargets(rawQuest: any): number[] {
  const targets = new Set<number>()
  ;(rawQuest?.steps || []).forEach((step: any) => {
    ;(step?.objectives || []).forEach((objective: any) => {
      const className = objective?.className || ''
      const typeId = Number(objective?.typeId || 0)
      if (className !== 'QuestObjectiveCraftItemData' && typeId !== 17) return
      const parameter = objective?.parameters?.parameter0
      if (parameter != null) targets.add(Number(parameter))
    })
  })
  return Array.from(targets).sort((a, b) => a - b)
}

function normalizeQuest(rawQuest: any, categories: Record<string, { name?: string }>): CachedQuest | null {
  const id = rawQuest?.id
  if (id == null) return null
  const name = rawLocaleValue(rawQuest, 'name', `Quête ${id}`)
  const slug = rawLocaleValue(rawQuest, 'slug', normalizeText(name))
  const need = rawQuest.need || {}
  const categoryId = Number(rawQuest.categoryId || 0)

  return {
    id: Number(id),
    name,
    slug,
    name_norm: normalizeText(name),
    slug_norm: normalizeText(slug),
    compact: compactText(name),
    level_min: Number(rawQuest.levelMin || 0),
    category_id: categoryId,
    category_name: categories[String(categoryId)]?.name || '',
    need_items: (need.items || []).map(Number),
    need_quantities: (need.quantities || []).map(Number),
    need_quests: (need.quests || []).map(Number),
    craft_targets: extractCraftTargets(rawQuest),
  }
}

function extractItemTypeId(rawItem: any): number | null {
  const typeId = rawItem?.typeId ?? rawItem?.type?.id
  const normalized = Number(typeId)
  return Number.isFinite(normalized) ? normalized : null
}

function extractItemTypeName(rawItem: any, locale: 'fr' | 'en'): string {
  return rawItem?.type?.name?.[locale] || ''
}

function extractItemTypeCategoryId(rawItem: any): number | null {
  const categoryId = Number(rawItem?.type?.categoryId)
  return Number.isFinite(categoryId) ? categoryId : null
}

function extractRawType(rawItem: any): string {
  return rawItem?.type?.superType?.name?.fr || rawItem?.type?.name?.fr || 'Equipement'
}

function normalizeApiItem(rawItem: any): CachedItem | null {
  const id = rawItem?.id
  if (id == null) return null
  const name = rawLocaleValue(rawItem, 'name', `Item ${id}`)
  const imageUrl = rawItem.img || rawItem.image || ''
  const rawType = extractRawType(rawItem)

  return {
    id: Number(id),
    name,
    raw_type: rawType,
    category: normalizeItemCategory(rawType),
    type_id: extractItemTypeId(rawItem),
    type_name: extractItemTypeName(rawItem, 'fr'),
    item_type_category_id: extractItemTypeCategoryId(rawItem),
    image_url: imageUrl,
    image_path: imageUrl,
  }
}

function normalizeRecipe(rawRecipe: any): Recipe | null {
  if (!rawRecipe) return null
  return {
    result_id: Number(rawRecipe.resultId),
    ingredient_ids: (rawRecipe.ingredientIds || []).map(Number),
    quantities: (rawRecipe.quantities || []).map(Number),
  }
}

function byId<T extends { id?: number; result_id?: number }>(rows: Array<T | null>, key: 'id' | 'result_id'): Record<string, T> {
  return Object.fromEntries(
    rows
      .filter((row): row is T => Boolean(row && row[key] != null))
      .map((row) => [String(row[key]), row]),
  )
}

function idsChecksum(ids: Iterable<string>): string {
  const sorted = Array.from(ids).map(String).sort().join('\n')
  let hash = 0
  for (let index = 0; index < sorted.length; index += 1) {
    hash = Math.imul(31, hash) + sorted.charCodeAt(index)
    hash |= 0
  }
  return String(hash >>> 0)
}

export async function syncQuestPlannerData(progress?: (message: string) => void): Promise<QuestPlannerData> {
  progress?.('Synchronisation DofusDB : catégories...')
  const rawCategoriesPromise = fetchPaginated('/quest-categories', PAGE_LIMIT, 'Catégories', progress)
  const rawItemsPromise = fetchPaginated('/items', PAGE_LIMIT, 'Items', progress)
  const rawRecipesPromise = fetchPaginated('/recipes', PAGE_LIMIT, 'Recettes', progress)

  const rawCategories = await rawCategoriesPromise
  const categories = byId(rawCategories.map(normalizeQuestCategory), 'id')

  progress?.('Synchronisation DofusDB : quêtes...')
  const rawQuestsPromise = fetchPaginated('/quests', PAGE_LIMIT, 'Quêtes', progress)
  const [rawQuests, rawItems, rawRecipes] = await Promise.all([
    rawQuestsPromise,
    rawItemsPromise,
    rawRecipesPromise,
  ])
  const quests = byId(rawQuests.map((rawQuest) => normalizeQuest(rawQuest, categories)), 'id')
  const items = byId(rawItems.map(normalizeApiItem), 'id')
  const recipes = byId(rawRecipes.map(normalizeRecipe), 'result_id')

  const metadata = {
    item_total: Object.keys(items).length,
    recipe_total: Object.keys(recipes).length,
    quest_total: Object.keys(quests).length,
    quest_category_total: Object.keys(categories).length,
    item_ids_checksum: idsChecksum(Object.keys(items)),
    recipe_ids_checksum: idsChecksum(Object.keys(recipes)),
    quest_ids_checksum: idsChecksum(Object.keys(quests)),
    quest_category_ids_checksum: idsChecksum(Object.keys(categories)),
    item_schema_version: 2,
    last_sync: new Date().toISOString(),
  }

  const data: QuestPlannerData = {
    quests,
    categories,
    items,
    recipes,
    exclusions: {
      item_type_category_ids: [4],
      item_type_ids: [80],
      raw_types: ['Bénédiction', 'Bonus de jeu de rôle', 'Malédiction', 'Mutation', 'Suiveur'],
      item_ids: [],
    },
    metadata,
  }

  await saveStoredQuestPlannerData(data)
  progress?.(`Données synchronisées : ${metadata.quest_total} quêtes, ${metadata.item_total} items, ${metadata.recipe_total} recettes`)
  return data
}

export async function checkQuestPlannerDataStatus(data: QuestPlannerData): Promise<DatabaseStatus> {
  const [questPage, categoryPage, itemPage, recipePage] = await Promise.all([
    apiGet('/quests', { $limit: 1, $skip: 0 }),
    apiGet('/quest-categories', { $limit: 1, $skip: 0 }),
    apiGet('/items', { $limit: 1, $skip: 0 }),
    apiGet('/recipes', { $limit: 1, $skip: 0 }),
  ])

  const status = {
    remoteQuestTotal: Number(questPage.total || 0),
    localQuestTotal: Object.keys(data.quests).length,
    remoteQuestCategoryTotal: Number(categoryPage.total || 0),
    localQuestCategoryTotal: Object.keys(data.categories).length,
    remoteItemTotal: Number(itemPage.total || 0),
    localItemTotal: Object.keys(data.items).length,
    remoteRecipeTotal: Number(recipePage.total || 0),
    localRecipeTotal: Object.keys(data.recipes).length,
  }

  const missingLabels = []
  if (status.remoteQuestTotal !== status.localQuestTotal) missingLabels.push('quêtes')
  if (status.remoteQuestCategoryTotal !== status.localQuestCategoryTotal) missingLabels.push('catégories')
  if (status.remoteItemTotal !== status.localItemTotal) missingLabels.push('items')
  if (status.remoteRecipeTotal !== status.localRecipeTotal) missingLabels.push('recettes')

  return {
    ...status,
    missingLabels,
    needsSync: missingLabels.length > 0,
  }
}
