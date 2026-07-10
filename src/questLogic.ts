import {
  loadCachedImageIds,
  loadFailedCachedImages,
  pruneCachedImages,
  saveCachedImage,
  saveFailedCachedImages,
  loadSharedCatalog,
  saveSharedCatalog,
  loadStoredQuestPlannerData,
  saveStoredQuestPlannerData,
  type FailedCachedImage,
} from './questStorage'

export const CATEGORIES = ['Equipement', 'Consommable', 'Ressource'] as const
const API_URL = 'https://api.dofusdb.fr'
const PAGE_LIMIT = 50
const PAGE_CONCURRENCY = 8
const REQUEST_TIMEOUT_MS = 8_000
const ESTIMATED_JSON_COMPRESSION_RATIO = 0.16
const ESTIMATED_IMAGE_BYTES = 40 * 1024
const FAILED_IMAGE_RETRY_MS = 24 * 60 * 60 * 1000
const TRANSIENT_FAILED_IMAGE_RETRY_MS = 15 * 60 * 1000

export type ItemCategory = (typeof CATEGORIES)[number]

export type QuestSyncEndpoint = 'questCategories' | 'achievements' | 'items' | 'recipes' | 'itemSets' | 'quests'

export type QuestSyncProgressEvent =
  | { kind: 'endpoint'; endpoint: QuestSyncEndpoint; label: string; done: number; total: number; bytesDone: number }
  | { kind: 'images'; done: number; total: number; bytesDone: number; bytesTotal?: number }
  | { kind: 'message'; message: string }

export type QuestSyncProgress = (event: QuestSyncProgressEvent | string) => void

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
  need_item_groups?: NeedItemGroup[]
  need_quests?: number[]
  craft_targets?: number[]
}

export interface NeedItemGroupItem {
  item_id: number
  quantity: number
}

export interface NeedItemGroupOption {
  label?: string
  items: NeedItemGroupItem[]
}

export interface NeedItemGroup {
  key?: string
  label?: string
  options: NeedItemGroupOption[]
}

export interface CachedAchievement {
  id: number
  name: string
  slug?: string
  name_norm?: string
  slug_norm?: string
  compact?: string
  points?: number
  level?: number
  category_id?: number
  category_name?: string
  need_quests?: number[]
  need_achievements?: number[]
  image_url?: string
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
  needItemGroups: NeedItemGroup[]
  needQuests: number[]
  craftTargets: number[]
  score: number
}

export interface AchievementInfo {
  kind: 'achievement'
  achievementId: number
  name: string
  slug: string
  points: number
  level: number
  categoryId: number
  categoryName: string
  needQuests: number[]
  needAchievements: number[]
  imageUrl: string
  score: number
}

export type SearchResult = ({ kind: 'quest' } & QuestInfo) | AchievementInfo

export interface AchievementChoiceOption {
  key: string
  label: string
  description: string
  questIds: number[]
  icon?: string
  materialIcon?: string
  visualClass?: string
}

export interface AchievementChoiceRule {
  achievementId: number
  title: string
  subtitle: string
  fixedQuestIds: number[]
  options: AchievementChoiceOption[]
}

export interface CachedItem {
  id: number
  name?: string
  raw_type?: string
  category?: string
  type_id?: number | null
  type_name?: string
  item_type_category_id?: number | null
  criterions?: string
  quests_that_use?: number[]
  quests_that_reward?: number[]
  image_url?: string
  image_path?: string
}

export interface HarvestableResource {
  item_id: number
  job: string
  rarity: 'normal' | 'rare' | 'meat'
  source_item_id?: number
  source_monster_id?: number
  source_monster_name?: string
  order: number
}

export interface ResourceOrigin {
  item_id: number
  origins: Array<{
    monster_id: number
    monster_name: string
    race_id: number | null
    race_name: string
    super_race_id: number | null
    super_race_name: string
    min_level: number | null
    max_level: number | null
    drop_rate: number
    has_criterions: boolean
  }>
}

export interface SortMetadata {
  harvestables: Record<string, HarvestableResource>
  resourceOrigins: Record<string, ResourceOrigin>
}

export interface Recipe {
  result_id: number
  ingredient_ids: number[]
  quantities: number[]
}

export interface ItemSet {
  id: number
  name: string
  name_norm: string
  compact: string
  item_ids: number[]
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

export interface AlternativeItemLine {
  item_id: number
  quantity: number
  name: string
  raw_type: string
  category: ItemCategory
  image_path: string
}

export interface AlternativeItemOption {
  option_key: string
  label: string
  items: AlternativeItemLine[]
}

export interface AlternativeItemGroupEntry {
  group_key: string
  label: string
  category: ItemCategory
  source_quests: string[]
  options: AlternativeItemOption[]
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
  achievements: Record<string, CachedAchievement>
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
  sortMetadata?: SortMetadata
  itemSets?: Record<string, ItemSet>
}

interface SharedCatalogData {
  items?: Record<string, CachedItem>
  recipes?: Record<string, Recipe>
  itemSets?: Record<string, ItemSet>
  metadata?: Record<string, unknown>
  sortMetadata?: SortMetadata
}

export interface DatabaseStatus {
  needsSync: boolean
  remoteQuestTotal: number
  localQuestTotal: number
  remoteAchievementTotal: number
  localAchievementTotal: number
  remoteQuestCategoryTotal: number
  localQuestCategoryTotal: number
  remoteItemTotal: number
  localItemTotal: number
  remoteRecipeTotal: number
  localRecipeTotal: number
  remoteItemSetTotal: number
  localItemSetTotal: number
  missingImageGroups: number
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

export const ACHIEVEMENT_CHOICE_RULES: Record<number, AchievementChoiceRule> = {
  558: {
    achievementId: 558,
    title: 'Être plus royaliste que le roi',
    subtitle: 'Choisis la branche Allister à ajouter. Ce choix conditionne toute la suite de cette série.',
    fixedQuestIds: [208, 209, 211],
    options: [
      {
        key: 'vil-smisse',
        label: 'Trahir Allister',
        description: 'Branche de Vil Smisse',
        questIds: [216, 217, 218, 219, 220, 892],
        materialIcon: 'visibility_off',
        visualClass: 'choice-vil',
      },
      {
        key: 'allister',
        label: 'Servir Allister',
        description: 'Branche du roi Allister',
        questIds: [215, 221, 222, 224, 225, 891],
        materialIcon: 'account_balance',
        visualClass: 'choice-allister',
      },
    ],
  },
  607: {
    achievementId: 607,
    title: 'Agriculture ou alchimie',
    subtitle: 'Choisis le métier utilisé pour cette série de quêtes Frigost.',
    fixedQuestIds: [],
    options: [
      {
        key: 'paysan',
        label: 'Paysan',
        description: 'La branche des récoltes agricoles',
        questIds: [556, 557, 558, 559, 560, 561, 562, 563, 564, 565],
        icon: '/choice-icons/jobs/paysan.png',
        visualClass: 'choice-farmer',
      },
      {
        key: 'alchimiste',
        label: 'Alchimiste',
        description: 'La branche des récoltes alchimiques',
        questIds: [566, 567, 568, 569, 570, 571, 572, 573, 574, 575],
        icon: '/choice-icons/jobs/alchimiste.png',
        visualClass: 'choice-alchemist',
      },
    ],
  },
  554: {
    achievementId: 554,
    title: "L'âme de glace",
    subtitle: "Choisis la quête correspondant à ton alignement.",
    fixedQuestIds: [1317, 1318, 1326, 1327],
    options: [
      {
        key: 'bonta',
        label: 'Bontarien',
        description: 'La destinée',
        questIds: [710],
        icon: '/choice-icons/alignments/illus_bontarien.png',
        visualClass: 'choice-bonta',
      },
      {
        key: 'brakmar',
        label: 'Brâkmarien',
        description: 'La fatalité',
        questIds: [711],
        icon: '/choice-icons/alignments/illus_brakmarien.png',
        visualClass: 'choice-brakmar',
      },
      {
        key: 'neutre',
        label: 'Neutre',
        description: 'La rivalité',
        questIds: [1316],
        icon: '/choice-icons/alignments/illus_neutre.png',
        visualClass: 'choice-neutral',
      },
    ],
  },
  982: {
    achievementId: 982,
    title: 'Tampon saisonnier',
    subtitle: 'Choisis la version correspondant au niveau du personnage. Les autres quêtes du succès seront ajoutées automatiquement.',
    fixedQuestIds: [724, 725, 726, 741, 742],
    options: [
      {
        key: '1-50',
        label: 'Niveau 1-50',
        description: 'Éklate vulkaine pour touriste',
        questIds: [720],
        icon: '/choice-icons/monsters/krokille-crue.png',
        visualClass: 'choice-vulkania',
      },
      {
        key: '51-100',
        label: 'Niveau 51-100',
        description: 'Éklate vulkaine pour amateur',
        questIds: [721],
        icon: '/choice-icons/monsters/krokille-crue.png',
        visualClass: 'choice-vulkania',
      },
      {
        key: '101-150',
        label: 'Niveau 101-150',
        description: 'Éklate vulkaine pour spécialiste',
        questIds: [722],
        icon: '/choice-icons/monsters/krokille-crue.png',
        visualClass: 'choice-vulkania',
      },
      {
        key: '151-200',
        label: 'Niveau 151-200',
        description: 'Éklate vulkaine pour expert',
        questIds: [723],
        icon: '/choice-icons/monsters/krokille-crue.png',
        visualClass: 'choice-vulkania',
      },
    ],
  },
  1678: {
    achievementId: 1678,
    title: 'Un citoyen modèle',
    subtitle: 'Choisis la quête de classe correspondant au personnage.',
    fixedQuestIds: [1958, 1959, 2009, 1960, 1962],
    options: [
      { key: 'feca', label: 'Féca', description: "Tournée d'inspection", questIds: [1963], icon: '/choice-icons/classes/symbol_1.png', visualClass: 'choice-class' },
      { key: 'osamodas', label: 'Osamodas', description: 'Série animalière', questIds: [1964], icon: '/choice-icons/classes/symbol_2.png', visualClass: 'choice-class' },
      { key: 'enutrof', label: 'Enutrof', description: 'La fête de la chocopépite', questIds: [1965], icon: '/choice-icons/classes/symbol_3.png', visualClass: 'choice-class' },
      { key: 'sram', label: 'Sram', description: 'Crime et châtiment', questIds: [1966], icon: '/choice-icons/classes/symbol_4.png', visualClass: 'choice-class' },
      { key: 'xelor', label: 'Xélor', description: "Tarot, t'es très fort", questIds: [1967], icon: '/choice-icons/classes/symbol_5.png', visualClass: 'choice-class' },
      { key: 'ecaflip', label: 'Ecaflip', description: 'Au petit malheur la chance', questIds: [1968], icon: '/choice-icons/classes/symbol_6.png', visualClass: 'choice-class' },
      { key: 'eniripsa', label: 'Eniripsa', description: 'Piques de solution', questIds: [1969], icon: '/choice-icons/classes/symbol_7.png', visualClass: 'choice-class' },
      { key: 'iop', label: 'Iop', description: 'Iop et hop', questIds: [1970], icon: '/choice-icons/classes/symbol_8.png', visualClass: 'choice-class' },
      { key: 'cra', label: 'Crâ', description: "C'est pour ta pomme", questIds: [1971], icon: '/choice-icons/classes/symbol_9.png', visualClass: 'choice-class' },
      { key: 'sadida', label: 'Sadida', description: "C'est pourtant naturel", questIds: [1972], icon: '/choice-icons/classes/symbol_10.png', visualClass: 'choice-class' },
      { key: 'sacrieur', label: 'Sacrieur', description: 'Souffre-douleur', questIds: [1973], icon: '/choice-icons/classes/symbol_11.png', visualClass: 'choice-class' },
      { key: 'pandawa', label: 'Pandawa', description: "Trempette dans un verre d'eau", questIds: [1974], icon: '/choice-icons/classes/symbol_12.png', visualClass: 'choice-class' },
      { key: 'roublard', label: 'Roublard', description: 'Braquage à la Roublard', questIds: [704], icon: '/choice-icons/classes/symbol_13.png', visualClass: 'choice-class' },
      { key: 'zobal', label: 'Zobal', description: 'Zobal Hibaba et les 40 Roublards', questIds: [716], icon: '/choice-icons/classes/symbol_14.png', visualClass: 'choice-class' },
      { key: 'steamer', label: 'Steamer', description: "L'étrange créature de l'étang bleu", questIds: [938], icon: '/choice-icons/classes/symbol_15.png', visualClass: 'choice-class' },
      { key: 'eliotrope', label: 'Eliotrope', description: 'Un rayon de soleil', questIds: [1615], icon: '/choice-icons/classes/symbol_16.png', visualClass: 'choice-class' },
      { key: 'huppermage', label: 'Huppermage', description: "Les paroles s'envolent, les aigris restent", questIds: [1677], icon: '/choice-icons/classes/symbol_17.png', visualClass: 'choice-class' },
      { key: 'ouginak', label: 'Ouginak', description: 'Une vie de milichien', questIds: [1841], icon: '/choice-icons/classes/symbol_18.png', visualClass: 'choice-class' },
      { key: 'forgelance', label: 'Forgelance', description: 'La routine anodine du chevalier citadin', questIds: [2470], icon: '/choice-icons/classes/symbol_20.png', visualClass: 'choice-class' },
    ],
  },
}

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

export function normalizeItemCategory(rawType = '', typeName = ''): ItemCategory {
  const raw = normalizeText(rawType)
  const type = normalizeText(typeName)

  if (raw === 'ressource' || raw === 'objet de quete' || raw === 'certificat') return 'Ressource'
  if (raw === 'consommable') return 'Consommable'
  if (type.includes('jeton') || type.includes('monnaie') || type.includes('ressource')) return 'Ressource'
  if (type.includes('potion') || type.includes('pain') || type.includes('biere') || type.includes('poisson comestible')) return 'Consommable'

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
    needItemGroups: (rawQuest.need_item_groups || []).map((group, groupIndex) => ({
      key: group.key || `group-${groupIndex + 1}`,
      label: group.label || 'Choix de prérequis',
      options: (group.options || []).map((option, optionIndex) => ({
        label: option.label || `Choix ${optionIndex + 1}`,
        items: (option.items || []).map((item) => ({
          item_id: Number(item.item_id),
          quantity: Number(item.quantity || 0),
        })),
      })),
    })),
    needQuests: (rawQuest.need_quests || []).map(Number),
    craftTargets: (rawQuest.craft_targets || []).map(Number),
    score: 0,
  }
}

export function questResultFromInfo(quest: QuestInfo): SearchResult {
  return { ...quest, kind: 'quest' }
}

export function achievementInfoFromCache(rawAchievement: CachedAchievement): AchievementInfo {
  return {
    kind: 'achievement',
    achievementId: Number(rawAchievement.id),
    name: rawAchievement.name || `Succès ${rawAchievement.id}`,
    slug: rawAchievement.slug || '',
    points: Number(rawAchievement.points || 0),
    level: Number(rawAchievement.level || 0),
    categoryId: Number(rawAchievement.category_id || 0),
    categoryName: rawAchievement.category_name || '',
    needQuests: (rawAchievement.need_quests || []).map(Number),
    needAchievements: (rawAchievement.need_achievements || []).map(Number),
    imageUrl: rawAchievement.image_url || '',
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

function achievementScore(queryNorm: string, achievement: AchievementInfo): number {
  const nameNorm = normalizeText(achievement.name)
  const slugNorm = normalizeText(achievement.slug)
  const queryCompact = queryNorm.replace(/\s/g, '')
  const nameCompact = nameNorm.replace(/\s/g, '')

  if (queryNorm === nameNorm || queryNorm === slugNorm) return 1.18
  if (nameNorm.startsWith(queryNorm) || slugNorm.startsWith(queryNorm)) return 1.03
  if (nameNorm.includes(queryNorm) || slugNorm.includes(queryNorm)) return 0.91
  if (queryCompact && nameCompact.includes(queryCompact)) return 0.86

  const tokens = queryNorm.split(' ').filter(Boolean)
  if (!tokens.length) return 0
  const matched = tokens.filter((token) => nameNorm.includes(token) || slugNorm.includes(token)).length
  return matched / tokens.length
}

export function searchQuestsAndCategories(data: QuestPlannerData, query: string, limit = 80): SearchResult[] {
  const queryNorm = normalizeText(query)
  if (!queryNorm) return []

  const results: SearchResult[] = []
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

  results.push(...Array.from(scoredById.values()).map(questResultFromInfo))

  Object.values(data.achievements || {}).forEach((rawAchievement) => {
    const achievement = achievementInfoFromCache(rawAchievement)
    const score = achievementScore(queryNorm, achievement)
    if (score >= 0.35) {
      results.push({ ...achievement, score })
    }
  })

  return results
    .sort((a, b) => {
      const aLevel = a.kind === 'quest' ? a.levelMin : a.level
      const bLevel = b.kind === 'quest' ? b.levelMin : b.level
      return b.score - a.score || aLevel - bLevel || a.name.localeCompare(b.name, 'fr')
    })
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

export function parseClipboardQuests(data: QuestPlannerData, text: string): { found: SearchResult[]; missed: string[] } {
  const found: SearchResult[] = []
  const missed: string[] = []
  const seen = new Set<string>()

  splitQuestLines(text).forEach((line) => {
    const result = searchQuestsAndCategories(data, line, 4).find((candidate) => candidate.score >= 0.7)
    const resultKey = result?.kind === 'quest' ? `quest:${result.questId}` : `achievement:${result?.achievementId}`
    if (result && !seen.has(resultKey)) {
      found.push(result)
      seen.add(resultKey)
    } else if (!result) {
      missed.push(line)
    }
  })

  return { found, missed }
}

export function questInfoById(data: QuestPlannerData, questId: number): QuestInfo | null {
  const rawQuest = data.quests[String(questId)]
  return rawQuest ? questInfoFromCache(rawQuest) : null
}

export function achievementChoiceRulesFor(
  data: QuestPlannerData,
  achievementId: number,
  choices: Record<number, string> = {},
  visited = new Set<number>(),
): AchievementChoiceRule[] {
  if (visited.has(achievementId)) return []
  visited.add(achievementId)

  const rawAchievement = data.achievements?.[String(achievementId)]
  if (!rawAchievement) return []

  const rules: AchievementChoiceRule[] = []
  const directRule = ACHIEVEMENT_CHOICE_RULES[achievementId]
  if (directRule && !choices[achievementId]) {
    rules.push(directRule)
  }

  ;(rawAchievement.need_achievements || []).forEach((childId) => {
    rules.push(...achievementChoiceRulesFor(data, Number(childId), choices, visited))
  })

  return rules
}

export function expandAchievementQuestIds(
  data: QuestPlannerData,
  achievementId: number,
  choices: Record<number, string> = {},
  visited = new Set<number>(),
): number[] {
  if (visited.has(achievementId)) return []
  visited.add(achievementId)

  const rawAchievement = data.achievements?.[String(achievementId)]
  if (!rawAchievement) return []

  const questIds = new Set<number>()
  const rule = ACHIEVEMENT_CHOICE_RULES[achievementId]

  if (rule) {
    const selectedOption = rule.options.find((option) => option.key === choices[achievementId])
    if (rule.options.length && !selectedOption) return []
    rule.fixedQuestIds.forEach((questId) => questIds.add(Number(questId)))
    selectedOption?.questIds.forEach((questId) => questIds.add(Number(questId)))
  } else {
    ;(rawAchievement.need_quests || []).forEach((questId) => questIds.add(Number(questId)))
  }

  ;(rawAchievement.need_achievements || []).forEach((childId) => {
    expandAchievementQuestIds(data, Number(childId), choices, visited).forEach((questId) => questIds.add(questId))
  })

  return Array.from(questIds)
}

export function expandAchievementToQuests(
  data: QuestPlannerData,
  achievementId: number,
  choices: Record<number, string> = {},
): QuestInfo[] {
  return expandAchievementQuestIds(data, achievementId, choices)
    .map((questId) => questInfoById(data, questId))
    .filter((quest): quest is QuestInfo => Boolean(quest))
}

function itemImagePath(item: CachedItem): string {
  const imagePath = item.image_path || ''
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return ''
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
  const typeName = item?.type_name || ''
  const sourceCount = new Set(sourceQuests).size
  return {
    item_id: itemId,
    quantity,
    name: item?.name || `Item ${itemId}`,
    category: normalizeItemCategory(rawType, typeName),
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

  const isNormalEquipment = Number(item.item_type_category_id) === 0
  const hasRecipe = Boolean(data.recipes[String(item.id)])
  const isQuestStartedCondition = /\bQa[=<>]/.test(item.criterions || '')
  if (isNormalEquipment && !hasRecipe && isQuestStartedCondition) return true

  const rawTypes = new Set([...EXCLUDED_LEGACY_RAW_TYPES, ...(data.exclusions.raw_types || [])])
  return rawTypes.has(item.raw_type || '')
}

function isRecipeExcluded(item: CachedItem | undefined, data: QuestPlannerData): boolean {
  return isItemExcluded(item, data) || normalizeText(item?.name || '').includes('eklame')
}

function isUniquePossessionPrerequisite(item: CachedItem | undefined): boolean {
  return normalizeText(item?.type_name || '') === 'dofus'
}

export function buildBaseEntries(data: QuestPlannerData, quests: QuestInfo[]): ItemEntry[] {
  const totals = new Map<number, number>()
  const sources = new Map<number, string[]>()
  const firstOrder = new Map<number, number>()
  const selectedEquipmentCraftTargets = new Set(
    quests
      .flatMap((quest) => quest.craftTargets)
      .filter((itemId) => Number(data.items[String(itemId)]?.item_type_category_id) === 0),
  )

  quests.forEach((quest, questIndex) => {
    quest.needItems.forEach((itemId, index) => {
      if (selectedEquipmentCraftTargets.has(Number(itemId))) return

      const quantity = Number(quest.needQuantities[index] || 0)
      const item = data.items[String(itemId)]
      const existing = totals.get(itemId) || 0
      totals.set(itemId, isUniquePossessionPrerequisite(item) ? Math.max(existing, quantity) : existing + quantity)
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

function stripBundledImagePaths<T extends { items?: Record<string, CachedItem> }>(data: T): { data: T; changed: boolean } {
  let changed = false
  const items = Object.fromEntries(Object.entries(data.items || {}).map(([id, item]) => {
    if (!item.image_path || item.image_path.startsWith('http://') || item.image_path.startsWith('https://')) return [id, item]
    changed = true
    return [id, { ...item, image_path: '' }]
  }))
  return { data: changed ? { ...data, items } : data, changed }
}

async function loadSortMetadata(): Promise<Pick<QuestPlannerData, 'sortMetadata'>> {
  const [harvestables, resourceOrigins] = await Promise.all([
    fetch('/data/harvestable_resources.json').then((response) => response.json()).catch(() => ({})) as Promise<Record<string, HarvestableResource>>,
    fetch('/data/resource_origins.json').then((response) => response.json()).catch(() => ({})) as Promise<Record<string, ResourceOrigin>>,
  ])
  return { sortMetadata: { harvestables, resourceOrigins } }
}

function normalizeSharedItems(items: Record<string, CachedItem> | undefined): Record<string, CachedItem> | null {
  if (!items || !Object.keys(items).length) return null
  return Object.fromEntries(Object.entries(items).map(([id, item]) => {
    const rawType = item.raw_type || 'Equipement'
    const typeName = item.type_name || ''
    return [id, {
      ...item,
      id: Number(item.id ?? id),
      raw_type: rawType,
      type_name: typeName,
      category: item.category || normalizeItemCategory(rawType, typeName),
      image_url: item.image_url || '',
      image_path: item.image_path?.startsWith('http') ? item.image_path : '',
    }]
  }))
}

function applySharedCatalog(data: QuestPlannerData, shared: SharedCatalogData | null): QuestPlannerData {
  const items = normalizeSharedItems(shared?.items)
  if (shared?.metadata?.shared_sync_state !== 'complete' || !items || !shared?.recipes || !Object.keys(shared.recipes).length) return {
    ...data,
    items: {},
    recipes: {},
    itemSets: {},
    metadata: {
      ...data.metadata,
      shared_sync_state: 'bootstrap',
      dofusdb_item_total: 0,
      dofusdb_recipe_total: 0,
      dofusdb_item_set_total: 0,
    },
  }
  return {
    ...data,
    items,
    recipes: shared.recipes,
    itemSets: shared.itemSets || data.itemSets,
    metadata: {
      ...data.metadata,
      ...(shared.metadata || {}),
      dofusdb_item_total: Number(shared.metadata?.item_total || Object.keys(items).length),
      dofusdb_recipe_total: Number(shared.metadata?.recipe_total || Object.keys(shared.recipes).length),
      dofusdb_item_set_total: Number(shared.metadata?.item_set_total || Object.keys(shared.itemSets || {}).length),
    },
    sortMetadata: shared.sortMetadata || data.sortMetadata,
  }
}

function toSharedCatalog(data: QuestPlannerData, previous: SharedCatalogData | null): SharedCatalogData {
  const sharedItems = stripBundledImagePaths({ items: data.items }).data.items || {}
  const remote = data.metadata?.remote || previous?.metadata?.remote
  return {
    ...(previous || {}),
    items: sharedItems,
    recipes: Object.fromEntries(Object.entries(data.recipes || {}).filter((entry): entry is [string, Recipe] => Boolean(entry[1]))),
    itemSets: data.itemSets || previous?.itemSets || {},
    metadata: {
      ...(previous?.metadata || {}),
      item_total: Object.keys(data.items || {}).length,
      recipe_total: Object.keys(data.recipes || {}).length,
      item_set_total: Object.keys(data.itemSets || previous?.itemSets || {}).length,
      last_sync: data.metadata?.last_sync || new Date().toISOString(),
      remote,
      shared_sync_state: data.metadata?.shared_sync_state || (remote ? 'complete' : 'bootstrap'),
    },
    sortMetadata: data.sortMetadata,
  }
}

export async function loadQuestPlannerData(): Promise<QuestPlannerData> {
  const stored = await loadStoredQuestPlannerData().catch(() => null)
  const sharedCatalog = await loadSharedCatalog<SharedCatalogData>().catch(() => null)
  const sortMetadata = await loadSortMetadata()
  if (stored) {
    try {
      const bundledMetadata = await fetch('/data/metadata.json').then((response) => response.json())
      const normalizedStored = stripBundledImagePaths(stored)
      const storedWithAchievements = applySharedCatalog({ ...normalizedStored.data, achievements: stored.achievements || {}, ...sortMetadata }, sharedCatalog)
      const storedWasSynced = Boolean(storedWithAchievements.metadata?.last_sync)
      const bundledIsNewer =
        Number(bundledMetadata.quest_need_schema_version || 0) > Number(storedWithAchievements.metadata?.quest_need_schema_version || 0)
        || (!storedWasSynced && (
          Number(bundledMetadata.quest_total || 0) > Object.keys(storedWithAchievements.quests || {}).length
          || Number(bundledMetadata.achievement_total || 0) > Object.keys(storedWithAchievements.achievements || {}).length
          || Number(bundledMetadata.quest_category_total || 0) > Object.keys(storedWithAchievements.categories || {}).length
        ))

      if (!bundledIsNewer) {
        if (normalizedStored.changed) void saveStoredQuestPlannerData(storedWithAchievements).catch(() => {})
        return storedWithAchievements
      }

      if (storedWasSynced) {
        const [quests, achievements, categories, exclusions] = await Promise.all([
          fetch('/data/quests.json').then((response) => response.json()),
          fetch('/data/achievements.json').then((response) => response.json()).catch(() => ({})),
          fetch('/data/quest_categories.json').then((response) => response.json()),
          fetch('/data/item_exclusions.json').then((response) => response.json()),
        ])
        const merged: QuestPlannerData = {
          quests,
          achievements,
          categories,
          items: storedWithAchievements.items,
          recipes: storedWithAchievements.recipes,
          exclusions,
        metadata: {
          ...bundledMetadata,
          item_total: Object.keys(storedWithAchievements.items || {}).length,
          recipe_total: Object.keys(storedWithAchievements.recipes || {}).length,
          dofusdb_item_total: Number(storedWithAchievements.metadata?.dofusdb_item_total || Object.keys(storedWithAchievements.items || {}).length),
          dofusdb_recipe_total: Number(storedWithAchievements.metadata?.dofusdb_recipe_total || Object.keys(storedWithAchievements.recipes || {}).length),
          item_ids_checksum: idsChecksum(Object.keys(storedWithAchievements.items || {})),
          recipe_ids_checksum: idsChecksum(Object.keys(storedWithAchievements.recipes || {})),
          last_sync: storedWithAchievements.metadata?.last_sync || new Date().toISOString(),
          },
          ...sortMetadata,
        }
        await saveStoredQuestPlannerData(merged).catch(() => {})
        return merged
      }
    } catch {
      return applySharedCatalog({
        ...stored,
        achievements: stored.achievements || {},
        ...sortMetadata,
      }, sharedCatalog)
    }
  }

  const [quests, achievements, categories, exclusions, metadata] = await Promise.all([
    fetch('/data/quests.json').then((response) => response.json()),
    fetch('/data/achievements.json').then((response) => response.json()).catch(() => ({})),
    fetch('/data/quest_categories.json').then((response) => response.json()),
    fetch('/data/item_exclusions.json').then((response) => response.json()),
    fetch('/data/metadata.json').then((response) => response.json()),
  ])

  const bundled = stripBundledImagePaths({
    quests,
    achievements,
    categories,
    items: {},
    recipes: {},
    itemSets: {},
    exclusions,
    metadata: {
      ...metadata,
      shared_sync_state: 'bootstrap',
      dofusdb_item_total: 0,
      dofusdb_recipe_total: 0,
      dofusdb_item_set_total: 0,
    },
    ...sortMetadata,
  }).data
  return applySharedCatalog(bundled, sharedCatalog)
}

function optionCategory(items: AlternativeItemLine[]): ItemCategory {
  if (items.some((item) => item.category === 'Ressource')) return 'Ressource'
  if (items.some((item) => item.category === 'Consommable')) return 'Consommable'
  return items[0]?.category || 'Ressource'
}

export function alternativeGroupItemIds(quests: QuestInfo[]): number[] {
  return quests.flatMap((quest) =>
    quest.needItemGroups.flatMap((group) =>
      group.options.flatMap((option) => option.items.map((item) => Number(item.item_id))),
    ),
  )
}

export function buildAlternativeGroups(data: QuestPlannerData, quests: QuestInfo[]): AlternativeItemGroupEntry[] {
  const groups: AlternativeItemGroupEntry[] = []

  quests.forEach((quest, questIndex) => {
    quest.needItemGroups.forEach((group, groupIndex) => {
      const options = group.options
        .map((option, optionIndex) => {
          const items = option.items
            .map((entry) => {
              const itemId = Number(entry.item_id)
              const item = data.items[String(itemId)]
              const rawType = item?.raw_type || 'Ressource'
              const typeName = item?.type_name || ''
              return {
                item_id: itemId,
                quantity: Number(entry.quantity || 0),
                name: item?.name || `Item ${itemId}`,
                raw_type: rawType,
                category: normalizeItemCategory(rawType, typeName),
                image_path: item ? itemImagePath(item) : '',
              }
            })
            .filter((item) => item.quantity > 0 && !isItemExcluded(data.items[String(item.item_id)], data))

          return {
            option_key: `${quest.questId}:${group.key || groupIndex}:${optionIndex}`,
            label: option.label || `Choix ${optionIndex + 1}`,
            items,
          }
        })
        .filter((option) => option.items.length)

      if (options.length < 2) return

      groups.push({
        group_key: `${quest.questId}:${group.key || `group-${groupIndex + 1}`}`,
        label: group.label || quest.name,
        category: optionCategory(options.flatMap((option) => option.items)),
        source_quests: [quest.name],
        options,
        order: questIndex + 1,
      })
    })
  })

  return groups.sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.order - b.order || a.label.localeCompare(b.label, 'fr'))
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isRemoteImage(path: string | undefined): boolean {
  return /^https?:\/\//.test(path || '')
}

function itemImageSource(item: CachedItem): string {
  if (isRemoteImage(item.image_url)) return item.image_url || ''
  return isRemoteImage(item.image_path) ? item.image_path || '' : ''
}

export function groupMissingImages(data: QuestPlannerData, cachedIds: ReadonlySet<number>): Array<[string, CachedItem[]]> {
  const missingBySource = Object.values(data.items || {}).reduce((groups, item) => {
    const source = itemImageSource(item)
    if (!source || cachedIds.has(item.id)) return groups
    const group = groups.get(source) || []
    group.push(item)
    groups.set(source, group)
    return groups
  }, new Map<string, CachedItem[]>())
  return [...missingBySource.entries()]
}

function failedImageRetryMs(row: FailedCachedImage): number {
  return /failed to fetch|timeout|network|abort/i.test(row.reason || '')
    ? TRANSIENT_FAILED_IMAGE_RETRY_MS
    : FAILED_IMAGE_RETRY_MS
}

function isTransientImageFailure(row: FailedCachedImage): boolean {
  return failedImageRetryMs(row) === TRANSIENT_FAILED_IMAGE_RETRY_MS
}

function isRecentFailedImage(row: FailedCachedImage, now = Date.now()): boolean {
  return now - Date.parse(row.failedAt) < failedImageRetryMs(row)
}

function recentFailedImageIds(rows: FailedCachedImage[] | null, now = Date.now()): Set<number> {
  return new Set((rows || [])
    .filter((row) => isRecentFailedImage(row, now))
    .map((row) => row.itemId))
}

function mergeFailedImages(previous: FailedCachedImage[] | null, next: FailedCachedImage[]): FailedCachedImage[] {
  const recent = (previous || []).filter((row) => isRecentFailedImage(row))
  const byId = new Map(recent.map((row) => [row.itemId, row]))
  next.forEach((row) => byId.set(row.itemId, row))
  return [...byId.values()]
}

function estimatedCompressedJsonBytes(text: string, fallbackBytes?: number | null): number {
  const knownBytes = Number(fallbackBytes || 0)
  if (knownBytes > 0) return knownBytes
  return Math.max(1, Math.round(new Blob([text]).size * ESTIMATED_JSON_COMPRESSION_RATIO))
}

async function apiGetPayload(path: string, params: Record<string, string | number> = {}): Promise<{ data: any; bytes: number }> {
  const url = new URL(`${API_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const text = await invoke<string>('http_get', { url: url.toString() })
    return { data: JSON.parse(text), bytes: estimatedCompressedJsonBytes(text) }
  }

  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`DofusDB ${response.status} ${response.statusText}`)
  const text = await response.text()
  const headerBytes = Number(response.headers.get('content-length') || 0)
  const timingEntries = performance
    .getEntriesByName(url.toString())
    .filter((entry): entry is PerformanceResourceTiming => 'encodedBodySize' in entry)
  const timingBytes = timingEntries.length ? timingEntries[timingEntries.length - 1].encodedBodySize : 0
  return { data: JSON.parse(text), bytes: estimatedCompressedJsonBytes(text, headerBytes || timingBytes || 0) }
}

async function apiGet(path: string, params: Record<string, string | number> = {}): Promise<any> {
  return (await apiGetPayload(path, params)).data
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
  endpoint: QuestSyncEndpoint,
  label: string,
  progress?: QuestSyncProgress,
): Promise<any[]> {
  const firstPayload = await apiGetPayload(path, { $limit: limit, $skip: 0 })
  const firstPage = firstPayload.data
  const total = Number(firstPage.total || 0)
  const pageLimit = Number(firstPage.limit || limit)
  const rows = [...(firstPage.data || [])]
  let bytesDone = firstPayload.bytes
  progress?.({ kind: 'endpoint', endpoint, label, done: Math.min(rows.length, total), total, bytesDone })

  if (rows.length >= total || !rows.length) return rows

  const skips = []
  for (let skip = pageLimit; skip < total; skip += pageLimit) {
    skips.push(skip)
  }

  await mapWithConcurrency(skips, PAGE_CONCURRENCY, async (skip) => {
    const payload = await apiGetPayload(path, { $limit: limit, $skip: skip })
    const page = payload.data
    const data = page.data || []
    rows.push(...data)
    bytesDone += payload.bytes
    progress?.({ kind: 'endpoint', endpoint, label, done: Math.min(rows.length, total), total, bytesDone })
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
  bundledItemsCache = {}
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
      data.items[String(itemId)] = {
        ...bundled,
        image_path: bundled.image_path?.startsWith('http') ? bundled.image_path : '',
      }
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

function questNeedFieldsFromCurated(quest: CachedQuest | undefined): Pick<CachedQuest, 'need_items' | 'need_quantities' | 'need_item_groups' | 'need_quests' | 'craft_targets'> {
  return {
    need_items: (quest?.need_items || []).map(Number),
    need_quantities: (quest?.need_quantities || []).map(Number),
    need_item_groups: quest?.need_item_groups || [],
    need_quests: (quest?.need_quests || []).map(Number),
    craft_targets: (quest?.craft_targets || []).map(Number),
  }
}

function preserveCuratedQuestNeeds(quest: CachedQuest | null, curatedQuests: Record<string, CachedQuest>): CachedQuest | null {
  if (!quest) return null
  return {
    ...quest,
    ...questNeedFieldsFromCurated(curatedQuests[String(quest.id)]),
  }
}

function normalizeAchievement(rawAchievement: any): CachedAchievement | null {
  const id = rawAchievement?.id
  if (id == null) return null
  const name = rawLocaleValue(rawAchievement, 'name', `Succès ${id}`)
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
  const typeName = extractItemTypeName(rawItem, 'fr')

  return {
    id: Number(id),
    name,
    raw_type: rawType,
    category: normalizeItemCategory(rawType, typeName),
    type_id: extractItemTypeId(rawItem),
    type_name: typeName,
    item_type_category_id: extractItemTypeCategoryId(rawItem),
    criterions: rawItem.criterions || '',
    quests_that_use: (rawItem.questsThatUse || []).map(Number),
    quests_that_reward: (rawItem.questsThatReward || []).map(Number),
    image_url: imageUrl,
    image_path: '',
  }
}

function preserveCachedItemImage(item: CachedItem | null, curatedItems: Record<string, CachedItem>): CachedItem | null {
  if (!item) return null
  const curatedImagePath = curatedItems[String(item.id)]?.image_path || ''
  if (!curatedImagePath) {
    return item
  }

  return {
    ...item,
    image_path: curatedImagePath.startsWith('http://') || curatedImagePath.startsWith('https://') ? curatedImagePath : '',
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

function normalizeSet(rawSet: any): ItemSet | null {
  if (rawSet?.id == null) return null
  const name = rawSet.name?.fr || rawSet.slug?.fr || `Panoplie ${rawSet.id}`
  return {
    id: Number(rawSet.id),
    name,
    name_norm: normalizeText(name),
    compact: compactText(name),
    item_ids: (rawSet.items || []).map((item: any) => Number(item.id)).filter(Number.isFinite),
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

function latestUpdatedAt(rows: any[]): string {
  return rows.reduce((latest, row) => {
    const value = String(row?.updatedAt || '')
    return value > latest ? value : latest
  }, '')
}

async function endpointInfo(path: string): Promise<{ total: number; latestUpdatedAt: string }> {
  const page = await apiGet(path, { $limit: 1, $skip: 0, '$sort[updatedAt]': -1 })
  return {
    total: Number(page.total || 0),
    latestUpdatedAt: String(page.data?.[0]?.updatedAt || ''),
  }
}

function localRemoteMetadata(data: QuestPlannerData, sharedCatalog: SharedCatalogData | null, endpoint: 'items' | 'recipes' | 'itemSets'): { total: number; latestUpdatedAt: string } {
  if (data.metadata?.shared_sync_state === 'bootstrap' || sharedCatalog?.metadata?.shared_sync_state === 'bootstrap') {
    return { total: 0, latestUpdatedAt: '' }
  }
  const remote = (data.metadata?.remote || sharedCatalog?.metadata?.remote) as Record<string, { total?: number; latestUpdatedAt?: string }> | undefined
  const totalKeys = {
    items: 'dofusdb_item_total',
    recipes: 'dofusdb_recipe_total',
    itemSets: 'dofusdb_item_set_total',
  }
  const sharedTotalKeys = {
    items: 'item_total',
    recipes: 'recipe_total',
    itemSets: 'item_set_total',
  }
  const fallbackTotals = {
    items: Object.keys(data.items || sharedCatalog?.items || {}).length,
    recipes: Object.keys(data.recipes || sharedCatalog?.recipes || {}).length,
    itemSets: Object.keys(data.itemSets || sharedCatalog?.itemSets || {}).length,
  }
  return {
    total: Number(remote?.[endpoint]?.total || data.metadata?.[totalKeys[endpoint]] || sharedCatalog?.metadata?.[sharedTotalKeys[endpoint]] || 0) || fallbackTotals[endpoint],
    latestUpdatedAt: String(remote?.[endpoint]?.latestUpdatedAt || ''),
  }
}

export async function syncQuestPlannerData(
  progress?: QuestSyncProgress,
  curatedData?: QuestPlannerData,
  options: { includeQuestData?: boolean } = {},
): Promise<QuestPlannerData> {
  const includeQuestData = options.includeQuestData !== false
  if (!includeQuestData && curatedData) {
    progress?.({ kind: 'message', message: 'Synchronisation DofusDB : base commune...' })
    const [rawItems, rawRecipes, rawSets] = await Promise.all([
      fetchPaginated('/items', PAGE_LIMIT, 'items', 'Items', progress),
      fetchPaginated('/recipes', PAGE_LIMIT, 'recipes', 'Recettes', progress),
      fetchPaginated('/item-sets', PAGE_LIMIT, 'itemSets', 'Panoplies', progress),
    ])
    const curatedItems = curatedData.items || {}
    const items = byId(rawItems.map((rawItem) => preserveCachedItemImage(normalizeApiItem(rawItem), curatedItems)), 'id')
    const recipes = byId(rawRecipes.map(normalizeRecipe), 'result_id')
    const itemSets = byId(rawSets.map(normalizeSet), 'id')
    const sortMetadata = curatedData.sortMetadata ? { sortMetadata: curatedData.sortMetadata } : await loadSortMetadata()
    const data: QuestPlannerData = {
      ...curatedData,
      items,
      recipes,
      itemSets,
      metadata: {
        ...curatedData.metadata,
        item_total: Object.keys(items).length,
        recipe_total: Object.keys(recipes).length,
        item_set_total: Object.keys(itemSets).length,
        dofusdb_item_total: Object.keys(items).length,
        dofusdb_recipe_total: Object.keys(recipes).length,
        dofusdb_item_set_total: Object.keys(itemSets).length,
        item_ids_checksum: idsChecksum(Object.keys(items)),
        recipe_ids_checksum: idsChecksum(Object.keys(recipes)),
        item_schema_version: 2,
        last_sync: new Date().toISOString(),
      remote: {
        items: { total: Object.keys(items).length, latestUpdatedAt: latestUpdatedAt(rawItems) },
        recipes: { total: Object.keys(recipes).length, latestUpdatedAt: latestUpdatedAt(rawRecipes) },
        itemSets: { total: Object.keys(itemSets).length, latestUpdatedAt: latestUpdatedAt(rawSets) },
      },
      shared_sync_state: 'complete',
    },
      ...sortMetadata,
    }
    await saveStoredQuestPlannerData(data)
    await saveSharedCatalog(toSharedCatalog(data, await loadSharedCatalog<SharedCatalogData>().catch(() => null))).catch(() => {})
    progress?.({ kind: 'message', message: `Données synchronisées : ${Object.keys(items).length} items, ${Object.keys(recipes).length} recettes, ${Object.keys(itemSets).length} panoplies` })
    return data
  }

  progress?.({ kind: 'message', message: 'Synchronisation DofusDB : catégories...' })
  const rawCategoriesPromise = fetchPaginated('/quest-categories', PAGE_LIMIT, 'questCategories', 'Catégories', progress)
  const rawAchievementsPromise = fetchPaginated('/achievements', PAGE_LIMIT, 'achievements', 'Succès', progress)
  const rawItemsPromise = fetchPaginated('/items', PAGE_LIMIT, 'items', 'Items', progress)
  const rawRecipesPromise = fetchPaginated('/recipes', PAGE_LIMIT, 'recipes', 'Recettes', progress)
  const rawSetsPromise = fetchPaginated('/item-sets', PAGE_LIMIT, 'itemSets', 'Panoplies', progress)

  const rawCategories = await rawCategoriesPromise
  const categories = byId(rawCategories.map(normalizeQuestCategory), 'id')

  progress?.({ kind: 'message', message: 'Synchronisation DofusDB : quêtes...' })
  const rawQuestsPromise = fetchPaginated('/quests', PAGE_LIMIT, 'quests', 'Quêtes', progress)
  const [rawQuests, rawAchievements, rawItems, rawRecipes, rawSets] = await Promise.all([
    rawQuestsPromise,
    rawAchievementsPromise,
    rawItemsPromise,
    rawRecipesPromise,
    rawSetsPromise,
  ])
  const curatedQuests = curatedData?.quests || {}
  const quests = byId(
    rawQuests.map((rawQuest) => preserveCuratedQuestNeeds(normalizeQuest(rawQuest, categories), curatedQuests)),
    'id',
  )
  const achievements = byId(rawAchievements.map(normalizeAchievement), 'id')
  const curatedItems = curatedData?.items || {}
  const items = byId(rawItems.map((rawItem) => preserveCachedItemImage(normalizeApiItem(rawItem), curatedItems)), 'id')
  const recipes = byId(rawRecipes.map(normalizeRecipe), 'result_id')
  const itemSets = byId(rawSets.map(normalizeSet), 'id')
  const sortMetadata = curatedData?.sortMetadata ? { sortMetadata: curatedData.sortMetadata } : await loadSortMetadata()

  const metadata = {
    item_total: Object.keys(items).length,
    recipe_total: Object.keys(recipes).length,
    item_set_total: Object.keys(itemSets).length,
    dofusdb_item_total: Object.keys(items).length,
    dofusdb_recipe_total: Object.keys(recipes).length,
    dofusdb_item_set_total: Object.keys(itemSets).length,
    quest_total: Object.keys(quests).length,
    achievement_total: Object.keys(achievements).length,
    quest_category_total: Object.keys(categories).length,
    item_ids_checksum: idsChecksum(Object.keys(items)),
    recipe_ids_checksum: idsChecksum(Object.keys(recipes)),
    quest_ids_checksum: idsChecksum(Object.keys(quests)),
    achievement_ids_checksum: idsChecksum(Object.keys(achievements)),
    quest_category_ids_checksum: idsChecksum(Object.keys(categories)),
    item_schema_version: 2,
    quest_need_schema_version: Number(curatedData?.metadata?.quest_need_schema_version || 2),
    last_sync: new Date().toISOString(),
    remote: {
      items: { total: Object.keys(items).length, latestUpdatedAt: latestUpdatedAt(rawItems) },
      recipes: { total: Object.keys(recipes).length, latestUpdatedAt: latestUpdatedAt(rawRecipes) },
      itemSets: { total: Object.keys(itemSets).length, latestUpdatedAt: latestUpdatedAt(rawSets) },
    },
    shared_sync_state: 'complete',
  }

  const data: QuestPlannerData = {
    quests,
    achievements,
    categories,
    items,
    recipes,
    itemSets,
    exclusions: {
      item_type_category_ids: [4],
      item_type_ids: [80],
      raw_types: ['Bénédiction', 'Bonus de jeu de rôle', 'Malédiction', 'Mutation', 'Suiveur'],
      item_ids: [],
    },
    metadata,
    ...sortMetadata,
  }

  await saveStoredQuestPlannerData(data)
  await saveSharedCatalog(toSharedCatalog(data, await loadSharedCatalog<SharedCatalogData>().catch(() => null))).catch(() => {})
  progress?.({ kind: 'message', message: `Données synchronisées : ${metadata.quest_total} quêtes, ${metadata.achievement_total} succès, ${metadata.item_total} items, ${metadata.recipe_total} recettes` })
  return data
}

export async function syncQuestPlannerImages(
  data: QuestPlannerData,
  progress?: QuestSyncProgress,
): Promise<Map<number, string>> {
  const cachedIds = await loadCachedImageIds()
  const previousFailures = await loadFailedCachedImages().catch(() => null)
  const ignoredImageIds = recentFailedImageIds(previousFailures)
  const missing = groupMissingImages(data, new Set([...cachedIds, ...ignoredImageIds]))
  let cursor = 0
  let completed = 0
  let bytesDone = 0
  let successful = 0
  let bytesTotal = missing.length * ESTIMATED_IMAGE_BYTES
  const failures: FailedCachedImage[] = []
  progress?.({ kind: 'images', done: 0, total: missing.length, bytesDone, bytesTotal })
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, missing.length) }, async () => {
    while (cursor < missing.length) {
      const [source, items] = missing[cursor++]
      const savedItemIds = new Set<number>()
      try {
        const response = await fetch(source, { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        if (!response.ok) throw new Error(`Image ${response.status}`)
        const blob = await response.blob()
        bytesDone += blob.size
        successful += 1
        if (successful > 0) bytesTotal = Math.max(bytesDone, (bytesDone / successful) * missing.length)
        for (const item of items) {
          await saveCachedImage(item.id, blob)
          savedItemIds.add(item.id)
        }
      } catch (error) {
        const failedItems = items.filter((item) => !savedItemIds.has(item.id))
        if (failedItems.length) {
          const reason = String(error)
          console.warn('[QuestPlanner] image sync failed', {
            source,
            reason,
            items: failedItems.map((item) => ({ id: item.id, name: item.name })),
          })
          failures.push(...failedItems.map((item) => ({ itemId: item.id, source, failedAt: new Date().toISOString(), reason })))
        }
      } finally {
        completed += 1
        if (completed % 50 === 0 || completed === missing.length || completed === 1 || missing.length - completed <= 50) {
          progress?.({ kind: 'images', done: completed, total: missing.length, bytesDone, bytesTotal })
        }
      }
    }
  }))
  const transientFailures = failures.filter(isTransientImageFailure)
  const durableFailures = failures.filter((row) => !isTransientImageFailure(row))
  if (transientFailures.length) {
    throw new Error(`Connexion interrompue : ${transientFailures.length} images restent à télécharger`)
  }
  const validItemIds = Object.keys(data.items).map(Number)
  const validItemIdSet = new Set(validItemIds)
  const nextFailures = mergeFailedImages(previousFailures, durableFailures).filter((row) => validItemIdSet.has(row.itemId))
  if (durableFailures.length || nextFailures.length !== (previousFailures?.length || 0)) {
    await saveFailedCachedImages(nextFailures)
  }
  await pruneCachedImages(validItemIds).catch((error) => {
    console.warn('[QuestPlanner] shared image prune failed', error)
  })
  return new Map()
}

export async function checkQuestPlannerDataStatus(data: QuestPlannerData): Promise<DatabaseStatus> {
  const [questPage, achievementPage, categoryPage, itemPage, recipePage, itemSetPage] = await Promise.all([
    apiGet('/quests', { $limit: 1, $skip: 0 }),
    apiGet('/achievements', { $limit: 1, $skip: 0 }),
    apiGet('/quest-categories', { $limit: 1, $skip: 0 }),
    endpointInfo('/items'),
    endpointInfo('/recipes'),
    endpointInfo('/item-sets'),
  ])
  const sharedCatalog = await loadSharedCatalog<SharedCatalogData>().catch(() => null)
  const localItems = localRemoteMetadata(data, sharedCatalog, 'items')
  const localRecipes = localRemoteMetadata(data, sharedCatalog, 'recipes')
  const localItemSets = localRemoteMetadata(data, sharedCatalog, 'itemSets')

  const status = {
    remoteQuestTotal: Number(questPage.total || 0),
    localQuestTotal: Object.keys(data.quests).length,
    remoteAchievementTotal: Number(achievementPage.total || 0),
    localAchievementTotal: Object.keys(data.achievements || {}).length,
    remoteQuestCategoryTotal: Number(categoryPage.total || 0),
    localQuestCategoryTotal: Object.keys(data.categories).length,
    remoteItemTotal: itemPage.total,
    localItemTotal: localItems.total,
    remoteRecipeTotal: recipePage.total,
    localRecipeTotal: localRecipes.total,
    remoteItemSetTotal: itemSetPage.total,
    localItemSetTotal: localItemSets.total,
  }

  const missingLabels = []
  if (status.remoteItemTotal !== status.localItemTotal || (itemPage.latestUpdatedAt && itemPage.latestUpdatedAt !== localItems.latestUpdatedAt)) missingLabels.push('items')
  if (status.remoteRecipeTotal !== status.localRecipeTotal || (recipePage.latestUpdatedAt && recipePage.latestUpdatedAt !== localRecipes.latestUpdatedAt)) missingLabels.push('recettes')
  if (status.remoteItemSetTotal !== status.localItemSetTotal || (itemSetPage.latestUpdatedAt && itemSetPage.latestUpdatedAt !== localItemSets.latestUpdatedAt)) missingLabels.push('panoplies')
  const cachedIds = new Set(await loadCachedImageIds())
  const ignoredImageIds = recentFailedImageIds(await loadFailedCachedImages())
  const missingImageGroups = groupMissingImages(data, new Set([...cachedIds, ...ignoredImageIds])).length
  if (missingImageGroups > 0) missingLabels.push('images')

  return {
    ...status,
    missingImageGroups,
    missingLabels,
    needsSync: missingLabels.length > 0,
  }
}
