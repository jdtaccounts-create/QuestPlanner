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

async function closeChoice(page) {
  await page.locator('.choice-card .q-btn').first().click()
  await page.waitForFunction(() => !document.querySelector('.choice-card'))
}

async function assertChoiceImages(page, label, minimum) {
  const imageSources = await page.locator('.choice-option .choice-visual img').evaluateAll((images) =>
    images.map((image) => image.getAttribute('src') || ''),
  )
  if (imageSources.length < minimum) {
    throw new Error(`${label}: ${imageSources.length} image(s) de choix pour ${minimum} attendue(s)`)
  }
  const remoteSource = imageSources.find((source) => source.startsWith('http://') || source.startsWith('https://'))
  if (remoteSource) throw new Error(`${label}: image de choix distante interdite ${remoteSource}`)
}

async function openChoiceFromParser(page, query, expectedTitle) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), query)
  await page.getByLabel('Parser').click()
  await page.waitForFunction(
    (title) => document.querySelector('.choice-card h2')?.textContent === title,
    expectedTitle,
  )
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  await context.addInitScript(() => {
    sessionStorage.setItem('questplanner-smoke-mode', '1')
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url })

  const resetPage = await context.newPage()
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

  const page = await context.newPage()
  trackErrors(page)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByLabel('Passer en mode clair').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.getByLabel('Passer en mode sombre').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')

  await page.evaluate(() => navigator.clipboard.writeText('Abysses'))
  await page.getByLabel('Parser').click()
  await page.waitForFunction(() => document.querySelectorAll('.quest-chip').length > 1)
  const parsedAchievementQuestCount = await page.locator('.quest-chip').count()
  if (parsedAchievementQuestCount < 10) {
    throw new Error(`Achievement parser added too few quests: ${parsedAchievementQuestCount}`)
  }
  await page.getByLabel('Vider').click()

  await page.evaluate(() => navigator.clipboard.writeText("Un citoyen modèle\nSix sur six\nL'âme de glace"))
  await page.getByLabel('Parser').click()
  await page.waitForSelector('.choice-card h2')
  const firstChoiceTitle = await page.locator('.choice-card h2').textContent()
  if (firstChoiceTitle !== 'Un citoyen modèle') {
    throw new Error(`Unexpected first choice dialog: ${firstChoiceTitle}`)
  }
  await assertChoiceImages(page, 'Un citoyen modèle', 19)
  await page.locator('.choice-option').filter({ hasText: 'Féca' }).first().click()
  await page.waitForFunction(() => document.querySelector('.choice-card h2')?.textContent === "L'âme de glace")
  await assertChoiceImages(page, "L'âme de glace", 3)
  if (await page.locator('.choice-option').filter({ hasText: 'Féca' }).count()) {
    throw new Error('Regression: class choice was requested twice in the same parse queue')
  }
  await closeChoice(page)
  await page.getByLabel('Vider').click()

  await openChoiceFromParser(page, 'Être plus royaliste que le roi', 'Être plus royaliste que le roi')
  if (await page.locator('.choice-option .q-icon').count() < 2) {
    throw new Error('Être plus royaliste que le roi: icônes de choix Allister absentes')
  }
  await closeChoice(page)
  await page.getByLabel('Vider').click()

  await openChoiceFromParser(page, 'Agriculture ou alchimie', 'Agriculture ou alchimie')
  await assertChoiceImages(page, 'Agriculture ou alchimie', 2)
  await closeChoice(page)
  await page.getByLabel('Vider').click()

  await openChoiceFromParser(page, 'Tampon saisonnier', 'Tampon saisonnier')
  await assertChoiceImages(page, 'Tampon saisonnier', 4)
  await closeChoice(page)
  await page.getByLabel('Vider').click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Hôtel de glace')
  await page.locator('.result-row').filter({ hasText: 'Hôtel de glace' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length > 0)
  await page.waitForFunction(() => document.body.innerText.includes('Scie à glace'))
  if (await page.locator('.item-card').filter({ hasText: 'Item 11279' }).count()) {
    throw new Error('Regression: Hôtel de glace still shows Item 11279 fallback')
  }
  await page.locator('.craft-rail').click()
  await page.waitForFunction(() => document.body.innerText.includes('Aile de Mansobèse'))
  await page.locator('.craft-heading .q-btn').first().click()
  await page.getByLabel('Vider').click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill("Wogew l'hewmite")
  await page.locator('.result-row').filter({ hasText: "Wogew l'hewmite" }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.quest-chip').length === 1)
  if (await page.locator('.item-row').filter({ hasText: 'Crocobur' }).count()) {
    throw new Error('Regression: quest-gated equipment still shows as a preparable item')
  }
  await page.getByLabel('Vider').click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Aventure miniature')
  await page.locator('.result-row').filter({ hasText: 'Aventure miniature' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.quest-chip').length === 1)
  if (await page.locator('.item-row').filter({ hasText: 'Baguette Rikiki' }).count()) {
    throw new Error('Regression: Baguette Rikiki still shows as a preparable item')
  }
  await page.getByLabel('Vider').click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('À la croisée des mondes')
  await page.locator('.result-row').filter({ hasText: 'À la croisée des mondes' }).first().click()
  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Maudite disparition')
  await page.locator('.result-row').filter({ hasText: 'Maudite disparition' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.quest-chip').length === 2)
  if (await page.locator('.item-row').filter({ hasText: 'Pandaclier' }).count()) {
    throw new Error('Regression: selected craft target still shows as a duplicated quest prerequisite')
  }
  await page.getByLabel('Vider').click()

  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Du pain pour les braves')
  await page.locator('.result-row').filter({ hasText: 'Du pain pour les braves' }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length > 0)

  const itemRows = await page.locator('.item-row').count()
  if (itemRows < 1) throw new Error('No item rows after computing quest items')
  const firstOwnedInput = page.locator('.item-row .owned-input').first()
  await firstOwnedInput.fill('0')
  await firstOwnedInput.hover()
  await page.mouse.wheel(0, -100)
  await page.waitForFunction(() => document.querySelector('.item-row .owned-input')?.value === '1')
  const firstOwnedMaximum = await firstOwnedInput.getAttribute('max')
  await firstOwnedInput.fill(firstOwnedMaximum || '1')
  await firstOwnedInput.press('Enter')
  if (!await page.locator('.item-row').first().evaluate((row) => row.classList.contains('done'))) {
    throw new Error('Remplir la quantité possédée au maximum ne coche pas automatiquement la ligne principale')
  }
  await firstOwnedInput.fill('0')
  await firstOwnedInput.press('Enter')
  await page.waitForFunction(() => document.querySelector('.item-row .owned-input')?.value === '0')
  if (await page.locator('.item-row').first().evaluate((row) => row.classList.contains('done'))) {
    throw new Error('Baisser la quantité possédée ne décoche pas la ligne principale')
  }

  await page.locator('.craft-rail').click()
  await page.waitForFunction(() => document.querySelectorAll('.craft-row').length > 0)

  const craftRow = page.locator('.craft-row').first()
  const itemId = await craftRow.getAttribute('data-item-id')
  if (!itemId) throw new Error('Craft row has no data-item-id')
  const craftOwnedInput = craftRow.locator('.owned-input')
  await craftOwnedInput.fill('0')
  await craftOwnedInput.press('Enter')
  await craftOwnedInput.hover()
  await page.mouse.wheel(0, -100)
  await page.waitForFunction(() => document.querySelector('.craft-row .owned-input')?.value === '1')
  await page.mouse.wheel(0, 100)
  await page.waitForFunction(() => document.querySelector('.craft-row .owned-input')?.value === '0')

  await craftRow.locator('input[type="checkbox"]').click()
  const mainRow = page.locator(`.item-row[data-item-id="${itemId}"]`).first()
  await page.waitForFunction(
    (id) => document.querySelector(`.item-row[data-item-id="${id}"]`)?.classList.contains('done'),
    itemId,
  )

  await page.getByLabel('Vider').click()
  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill('Sur fond de crise')
  await page.locator('.result-row').filter({ hasText: 'Sur fond de crise' }).first().click()
  await page.getByPlaceholder('Rechercher une quête ou un succès...').fill("L'odeur devant le seuil")
  await page.locator('.result-row').filter({ hasText: "L'odeur devant le seuil" }).first().click()
  await page.waitForFunction(
    () => document.body.innerText.includes("Bois d'Aquajou")
      && document.body.innerText.includes('Accélérateur de propulsion'),
  )

  await page.locator('.craft-rail').click()
  await page.waitForFunction(() => document.body.innerText.includes('Plan de craft'))
  await page.locator('.craft-row').filter({ hasText: 'Accélérateur de propulsion' }).first().locator('input[type="checkbox"]').click()
  await page.waitForFunction(
    () => document.querySelector('.craft-row[data-item-id="17991"]')?.getAttribute('data-progress') === '20',
  )
  await page.locator('.craft-heading .q-btn').first().click()

  const aquajouRow = page.locator('.item-row').filter({ hasText: "Bois d'Aquajou" }).first()
  if (await aquajouRow.evaluate((row) => row.classList.contains('done'))) {
    throw new Error('Regression: craft ingredient coverage checked direct quest resource')
  }

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
