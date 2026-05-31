import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const url = process.env.QUESTPLANNER_URL || 'http://127.0.0.1:5174'

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
})

const browserErrors = []

function trackErrors(page) {
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
}

try {
  const resetPage = await browser.newPage()
  await resetPage.goto(url, { waitUntil: 'domcontentloaded' })
  await resetPage.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('questplanner-quasar')
        request.onsuccess = () => resolve(null)
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve(null)
      }),
  )
  await resetPage.close()

  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  trackErrors(page)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('.theme-search-button').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.locator('.theme-search-button').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Hôtel de glace')
  await page.locator('.result-row').filter({ hasText: 'Hôtel de glace' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length > 0)
  await page.waitForFunction(() => document.body.innerText.includes('Aile de Mansobèse'))
  if (await page.locator('.item-card').filter({ hasText: 'Item 11279' }).count()) {
    throw new Error('Regression: Hôtel de glace still shows Item 11279 fallback')
  }
  await page.getByRole('button', { name: /Vider/i }).click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Du pain pour les braves')
  await page.locator('.result-row').filter({ hasText: 'Du pain pour les braves' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length > 0)

  const itemRows = await page.locator('.item-row').count()
  if (itemRows < 1) throw new Error('No item rows after computing quest items')

  await page.locator('.craft-rail').click()
  await page.waitForFunction(() => document.querySelectorAll('.craft-row').length > 0)

  const craftRow = page.locator('.craft-row').first()
  const itemId = await craftRow.getAttribute('data-item-id')
  if (!itemId) throw new Error('Craft row has no data-item-id')

  await craftRow.locator('input[type="checkbox"]').click()
  const mainRow = page.locator(`.item-row[data-item-id="${itemId}"]`).first()
  await page.waitForFunction(
    (id) => document.querySelector(`.item-row[data-item-id="${id}"]`)?.classList.contains('done'),
    itemId,
  )

  const screenshotPath = path.join(os.tmpdir(), 'questplanner-smoke.png')
  await page.screenshot({ path: screenshotPath, fullPage: false })

  if (browserErrors.length) {
    throw new Error(`Browser console errors: ${browserErrors.join(' | ')}`)
  }

  console.log(`Smoke OK: ${itemRows} item rows, craft sync item ${itemId}, screenshot ${screenshotPath}`)
  await page.close()
} finally {
  await browser.close()
}
