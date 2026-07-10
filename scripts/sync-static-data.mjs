import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_URL = 'https://api.dofusdb.fr'
const PAGE_LIMIT = 50
const PAGE_CONCURRENCY = 8
const scriptDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(scriptDir, '..', 'public', 'data')
const imageCacheDir = join(scriptDir, '..', 'public', 'cache', 'images')

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactText(value) {
  return normalizeText(value).replace(/\s/g, '')
}

function rawLocaleValue(raw, key, fallback) {
  return raw?.[key]?.fr || raw?.[key]?.en || fallback
}

function idsChecksum(ids) {
  const sorted = Array.from(ids).map(String).sort().join('\n')
  let hash = 0
  for (let index = 0; index < sorted.length; index += 1) {
    hash = Math.imul(31, hash) + sorted.charCodeAt(index)
    hash |= 0
  }
  return String(hash >>> 0)
}

async function apiGet(path, params = {}) {
  const url = new URL(`${API_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  const response = await fetch(url)
  if (!response.ok) throw new Error(`DofusDB ${response.status} ${response.statusText}: ${await response.text()}`)
  return response.json()
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function runNext() {
    const index = cursor
    cursor += 1
    if (index >= items.length) return
    results[index] = await worker(items[index], index)
    await runNext()
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()))
  return results
}

async function fetchPaginated(path, label) {
  const firstPage = await apiGet(path, { $limit: PAGE_LIMIT, $skip: 0 })
  const total = Number(firstPage.total || 0)
  const pageLimit = Number(firstPage.limit || PAGE_LIMIT) || PAGE_LIMIT
  const rows = [...(firstPage.data || [])]
  console.log(`${label} ${Math.min(rows.length, total)}/${total}`)

  const skips = []
  for (let skip = pageLimit; skip < total; skip += pageLimit) {
    skips.push(skip)
  }

  await mapWithConcurrency(skips, PAGE_CONCURRENCY, async (skip) => {
    const page = await apiGet(path, { $limit: PAGE_LIMIT, $skip: skip })
    rows.push(...(page.data || []))
    if (rows.length % 500 < PAGE_LIMIT || rows.length >= total) {
      console.log(`${label} ${Math.min(rows.length, total)}/${total}`)
    }
  })

  return rows
}

function byId(rows, key = 'id') {
  return Object.fromEntries(
    rows
      .filter((row) => row && row[key] != null)
      .map((row) => [String(row[key]), row]),
  )
}

function normalizeItemCategory(rawType = '') {
  if (rawType === 'Ressource' || rawType === 'Consommable') return rawType
  return 'Equipement'
}

function extractItemTypeId(rawItem) {
  const typeId = rawItem?.typeId ?? rawItem?.type?.id
  const normalized = Number(typeId)
  return Number.isFinite(normalized) ? normalized : null
}

function extractItemTypeName(rawItem, locale) {
  return rawItem?.type?.name?.[locale] || ''
}

function itemImagePath(itemId) {
  const cachedPath = join(imageCacheDir, `${itemId}.png`)
  return existsSync(cachedPath) ? `cache\\images\\${itemId}.png` : ''
}

function extractItemTypeCategoryId(rawItem) {
  const categoryId = Number(rawItem?.type?.categoryId)
  return Number.isFinite(categoryId) ? categoryId : null
}

function extractRawType(rawItem) {
  return rawItem?.type?.superType?.name?.fr || rawItem?.type?.name?.fr || 'Equipement'
}

function normalizeApiItem(rawItem) {
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
    type_name_en: extractItemTypeName(rawItem, 'en'),
    item_type_category_id: extractItemTypeCategoryId(rawItem),
    item_type_in_encyclopedia: Boolean(rawItem?.type?.isInEncyclopedia),
    criterions: rawItem.criterions || '',
    quests_that_use: (rawItem.questsThatUse || []).map(Number),
    quests_that_reward: (rawItem.questsThatReward || []).map(Number),
    image_url: imageUrl,
    image_path: itemImagePath(Number(id)),
  }
}

function normalizeRecipe(rawRecipe) {
  if (!rawRecipe) return null
  return {
    result_id: Number(rawRecipe.resultId),
    ingredient_ids: (rawRecipe.ingredientIds || []).map(Number),
    quantities: (rawRecipe.quantities || []).map(Number),
  }
}

function normalizeQuestCategory(rawCategory) {
  const id = rawCategory?.id
  if (id == null) return null
  const name = rawLocaleValue(rawCategory, 'name', `Categorie ${id}`)
  return {
    id: Number(id),
    name,
    name_norm: normalizeText(name),
    compact: compactText(name),
    order: Number(rawCategory.order || 0),
  }
}

function extractCraftTargets(rawQuest) {
  const targets = new Set()
  ;(rawQuest?.steps || []).forEach((step) => {
    ;(step?.objectives || []).forEach((objective) => {
      const className = objective?.className || ''
      const typeId = Number(objective?.typeId || 0)
      if (className !== 'QuestObjectiveCraftItemData' && typeId !== 17) return
      const parameter = objective?.parameters?.parameter0
      if (parameter != null) targets.add(Number(parameter))
    })
  })
  return Array.from(targets).sort((a, b) => a - b)
}

function normalizeQuest(rawQuest, categories) {
  const id = rawQuest?.id
  if (id == null) return null
  const name = rawLocaleValue(rawQuest, 'name', `Quete ${id}`)
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

async function loadExistingQuests() {
  try {
    return JSON.parse(await readFile(join(dataDir, 'quests.json'), 'utf8'))
  } catch {
    return {}
  }
}

function questNeedFieldsFromCurated(quest) {
  return {
    need_items: (quest?.need_items || []).map(Number),
    need_quantities: (quest?.need_quantities || []).map(Number),
    need_item_groups: quest?.need_item_groups || [],
    need_quests: (quest?.need_quests || []).map(Number),
    craft_targets: (quest?.craft_targets || []).map(Number),
  }
}

function preserveCuratedQuestNeeds(quest, curatedQuests) {
  if (!quest) return null
  return {
    ...quest,
    ...questNeedFieldsFromCurated(curatedQuests[String(quest.id)]),
  }
}

function normalizeAchievement(rawAchievement) {
  const id = rawAchievement?.id
  if (id == null) return null
  const name = rawLocaleValue(rawAchievement, 'name', `Succes ${id}`)
  const slug = rawLocaleValue(rawAchievement, 'slug', normalizeText(name))
  const need = rawAchievement.need || {}
  const categoryId = Number(rawAchievement.categoryId || rawAchievement.category?.id || 0)

  return {
    id: Number(id),
    name,
    slug,
    name_norm: normalizeText(name),
    slug_norm: normalizeText(slug),
    compact: compactText(name),
    points: Number(rawAchievement.points || 0),
    level: Number(rawAchievement.level || 0),
    category_id: categoryId,
    category_name: rawAchievement.category?.name?.fr || '',
    need_quests: (need.quests || []).map(Number),
    need_achievements: (need.achievements || []).map(Number),
    image_url: rawAchievement.img || '',
  }
}

const [existingQuests, rawCategories, rawItems, rawRecipes, rawAchievements] = await Promise.all([
  loadExistingQuests(),
  fetchPaginated('/quest-categories', 'Categories'),
  fetchPaginated('/items', 'Items'),
  fetchPaginated('/recipes', 'Recettes'),
  fetchPaginated('/achievements', 'Succes'),
])

const categories = byId(rawCategories.map(normalizeQuestCategory))
const rawQuests = await fetchPaginated('/quests', 'Quetes')
const items = byId(rawItems.map(normalizeApiItem))
const recipes = byId(rawRecipes.map(normalizeRecipe), 'result_id')
const achievements = byId(rawAchievements.map(normalizeAchievement))
const quests = byId(rawQuests.map((rawQuest) => preserveCuratedQuestNeeds(normalizeQuest(rawQuest, categories), existingQuests)))

const exclusions = {
  item_type_category_ids: [4],
  item_type_ids: [80],
  raw_types: ['Bénédiction', 'Bonus de jeu de rôle', 'Malédiction', 'Mutation', 'Suiveur'],
  item_ids: [15990],
}

const metadata = {
  item_total: Object.keys(items).length,
  recipe_total: Object.keys(recipes).length,
  item_ids_checksum: idsChecksum(Object.keys(items)),
  recipe_ids_checksum: idsChecksum(Object.keys(recipes)),
  quest_total: Object.keys(quests).length,
  quest_ids_checksum: idsChecksum(Object.keys(quests)),
  quest_category_total: Object.keys(categories).length,
  quest_category_ids_checksum: idsChecksum(Object.keys(categories)),
  achievement_total: Object.keys(achievements).length,
  achievement_ids_checksum: idsChecksum(Object.keys(achievements)),
  last_static_sync: new Date().toISOString(),
  item_schema_version: 2,
  quest_need_schema_version: 3,
}

await Promise.all([
  writeFile(join(dataDir, 'items.json'), `${JSON.stringify(items, null, 2)}\n`, 'utf8'),
  writeFile(join(dataDir, 'recipes.json'), `${JSON.stringify(recipes, null, 2)}\n`, 'utf8'),
  writeFile(join(dataDir, 'quest_categories.json'), `${JSON.stringify(categories, null, 2)}\n`, 'utf8'),
  writeFile(join(dataDir, 'quests.json'), `${JSON.stringify(quests, null, 2)}\n`, 'utf8'),
  writeFile(join(dataDir, 'achievements.json'), `${JSON.stringify(achievements, null, 2)}\n`, 'utf8'),
  writeFile(join(dataDir, 'item_exclusions.json'), JSON.stringify(exclusions, null, 2), 'utf8'),
  writeFile(join(dataDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
])

console.log(
  `OK ${metadata.quest_total} quetes, ${metadata.achievement_total} succes, ${metadata.item_total} items, ${metadata.recipe_total} recettes`,
)
