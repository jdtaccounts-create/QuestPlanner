import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONCURRENCY = Number(process.env.QUESTPLANNER_IMAGE_CONCURRENCY || 16)
const RETRIES = Number(process.env.QUESTPLANNER_IMAGE_RETRIES || 2)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(scriptDir, '..')
const dataDir = join(rootDir, 'public', 'data')
const imageCacheDir = join(rootDir, 'public', 'cache', 'images')
const itemsPath = join(dataDir, 'items.json')

function isRemoteUrl(value) {
  return /^https?:\/\//.test(String(value || ''))
}

function cachedImagePath(itemId) {
  return `cache\\images\\${itemId}.png`
}

function sourceUrl(item) {
  return isRemoteUrl(item.image_url) ? item.image_url : isRemoteUrl(item.image_path) ? item.image_path : ''
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

async function downloadImage(item, index, total) {
  const target = join(imageCacheDir, `${item.id}.png`)
  if (existsSync(target)) {
    item.image_path = cachedImagePath(item.id)
    return { status: 'cached' }
  }

  const url = sourceUrl(item)
  if (!url) return { status: 'missing-url' }

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      await writeFile(target, bytes)
      item.image_path = cachedImagePath(item.id)
      return { status: 'downloaded' }
    } catch (error) {
      if (attempt >= RETRIES) {
        console.warn(`Image ${index + 1}/${total} échouée ${item.id} ${item.name || ''}: ${error.message}`)
        return { status: 'failed' }
      }
    }
  }

  return { status: 'failed' }
}

const items = JSON.parse(await readFile(itemsPath, 'utf8'))
const rows = Object.values(items)
const stats = {
  cached: 0,
  downloaded: 0,
  failed: 0,
  missingUrl: 0,
}

await mkdir(imageCacheDir, { recursive: true })

await mapWithConcurrency(rows, CONCURRENCY, async (item, index) => {
  const result = await downloadImage(item, index, rows.length)
  if (result.status === 'cached') stats.cached += 1
  if (result.status === 'downloaded') stats.downloaded += 1
  if (result.status === 'failed') stats.failed += 1
  if (result.status === 'missing-url') stats.missingUrl += 1

  const done = index + 1
  if (done % 250 === 0 || done === rows.length) {
    console.log(
      `Images ${done}/${rows.length} | cache ${stats.cached} | téléchargées ${stats.downloaded} | échecs ${stats.failed} | sans URL ${stats.missingUrl}`,
    )
  }
})

await writeFile(itemsPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')

console.log(
  `OK images items : ${stats.cached} déjà en cache, ${stats.downloaded} téléchargées, ${stats.failed} échecs, ${stats.missingUrl} sans URL`,
)
