import { chromium } from 'playwright-core'

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
  const syncPage = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  trackErrors(syncPage)
  await syncPage.addInitScript(() => {
    const payloads = {
      '/quest-categories': { total: 1, data: [{ id: 1, name: { fr: 'Catégorie test' }, order: 1 }] },
      '/quests': {
        total: 1,
        data: [
          {
            id: 900001,
            name: { fr: 'Quête de test sync' },
            slug: { fr: 'quete-de-test-sync' },
            levelMin: 1,
            categoryId: 1,
            need: { items: [900101], quantities: [2], quests: [] },
            steps: [],
          },
        ],
      },
      '/achievements': { total: 0, data: [] },
      '/items': {
        total: 1,
        data: [
          {
            id: 900101,
            name: { fr: 'Item de test sync' },
            type: { id: 1, name: { fr: 'Ressource' }, categoryId: 1, superType: { name: { fr: 'Ressource' } } },
            img: '',
          },
        ],
      },
      '/recipes': { total: 0, data: [] },
    }

    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd !== 'http_get') throw new Error(`Unexpected command ${cmd}`)
        const path = new URL(args.url).pathname
        return JSON.stringify(payloads[path])
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    }
  })
  await syncPage.goto(url, { waitUntil: 'networkidle' })
  await syncPage.getByRole('button', { name: /Sync DofusDB/i }).click()
  const forceSyncButton = syncPage.getByRole('button', { name: /Forcer la sync/i })
  if (await forceSyncButton.isVisible().catch(() => false)) {
    await forceSyncButton.click()
  }
  await syncPage.waitForFunction(() => document.body.innerText.includes('1 quêtes · 0 succès · 1 items · 0 recettes'))
  await syncPage.close()

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
  await page.locator('.toolbar .q-btn').last().click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.locator('.toolbar .q-btn').last().click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Hôtel de glace')
  await page.locator('.result-row').filter({ hasText: 'Hôtel de glace' }).first().click()
  await page.getByRole('button', { name: /Chercher les items/i }).click()
  await page.waitForFunction(() => document.body.innerText.includes('4 items agrégés'))
  await page.waitForFunction(() => document.body.innerText.includes('Scie à glace'))
  if (await page.locator('.item-card').filter({ hasText: 'Item 11279' }).count()) {
    throw new Error('Regression: Hôtel de glace still shows Item 11279 fallback')
  }
  await page.getByRole('button', { name: /Vider/i }).click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Du pain pour les braves')
  await page.locator('.result-row').filter({ hasText: 'Du pain pour les braves' }).first().click()
  await page.getByRole('button', { name: /Chercher les items/i }).click()
  await page.waitForFunction(() => document.body.innerText.includes('items agrégés'))

  const itemRows = await page.locator('.item-row').count()
  if (itemRows < 1) throw new Error('No item rows after computing quest items')

  await page.locator('.toolbar').getByRole('button', { name: /Plan craft/i }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Plan craft prêt'))

  const craftRow = page.locator('.craft-row').first()
  const itemId = await craftRow.getAttribute('data-item-id')
  if (!itemId) throw new Error('Craft row has no data-item-id')

  await craftRow.locator('input[type="checkbox"]').click()
  const mainRow = page.locator(`.item-row[data-item-id="${itemId}"]`).first()
  await page.waitForFunction(
    (id) => document.querySelector(`.item-row[data-item-id="${id}"]`)?.classList.contains('done'),
    itemId,
  )

  const screenshotPath = 'D:\\Téléchargements\\questplanner-quasar\\questplanner-smoke.png'
  await page.screenshot({ path: screenshotPath, fullPage: false })

  if (browserErrors.length) {
    throw new Error(`Browser console errors: ${browserErrors.join(' | ')}`)
  }

  console.log(`Smoke OK: ${itemRows} item rows, craft sync item ${itemId}, screenshot ${screenshotPath}`)
  await page.close()
} finally {
  await browser.close()
}
