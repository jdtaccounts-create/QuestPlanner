import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_URL = 'https://api.dofusdb.fr'
const PAGE_LIMIT = 50
const scriptDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(scriptDir, '..', 'public', 'data')

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

function localValue(raw, key, fallback) {
  return raw?.[key]?.fr || raw?.[key]?.en || fallback
}

async function apiGet(path, params = {}) {
  const url = new URL(`${API_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  const response = await fetch(url)
  if (!response.ok) throw new Error(`DofusDB ${response.status} ${response.statusText}`)
  return response.json()
}

async function fetchPaginated(path, label) {
  const firstPage = await apiGet(path, { $limit: PAGE_LIMIT, $skip: 0 })
  const total = Number(firstPage.total || 0)
  const rows = [...(firstPage.data || [])]
  const pageLimit = Number(firstPage.limit || PAGE_LIMIT) || PAGE_LIMIT
  console.log(`${label} ${Math.min(rows.length, total)}/${total}`)

  for (let skip = pageLimit; skip < total; skip += pageLimit) {
    const page = await apiGet(path, { $limit: PAGE_LIMIT, $skip: skip })
    rows.push(...(page.data || []))
    if (rows.length % 500 < PAGE_LIMIT || rows.length >= total) {
      console.log(`${label} ${Math.min(rows.length, total)}/${total}`)
    }
  }

  return rows
}

function normalizeAchievement(rawAchievement) {
  const id = rawAchievement?.id
  if (id == null) return null
  const name = localValue(rawAchievement, 'name', `Succès ${id}`)
  const slug = localValue(rawAchievement, 'slug', normalizeText(name))
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

function byId(rows) {
  return Object.fromEntries(
    rows
      .filter(Boolean)
      .map((row) => [String(row.id), row]),
  )
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

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

const achievements = byId((await fetchPaginated('/achievements', 'Succès')).map(normalizeAchievement))
const metadataPath = join(dataDir, 'metadata.json')
const metadata = await readJson(metadataPath, {})

metadata.achievement_total = Object.keys(achievements).length
metadata.achievement_ids_checksum = idsChecksum(Object.keys(achievements))
metadata.last_achievement_sync = new Date().toISOString()

await writeFile(join(dataDir, 'achievements.json'), JSON.stringify(achievements), 'utf8')
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

console.log(`OK ${Object.keys(achievements).length} succès`)
