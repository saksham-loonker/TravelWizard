import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('opens to an empty real workflow and creates a source-backed plan', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'TravelWizard' })).toBeVisible()
  await expect(page.getByText('No demo trip is seeded.')).toBeVisible()

  await page.getByLabel('Destination').fill('Lisbon, Portugal')
  await page.getByLabel('Start').fill('2026-07-02')
  await page.getByLabel('End').fill('2026-07-04')
  await page.getByLabel('Travelers').fill('2')
  await page.getByLabel('Budget').fill('900')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Trip workspace created.')).toBeVisible()
  await expect(page.getByText(/Map source (fixture|cache)/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent Trips' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Pair' }).click()
  await expect(page.getByText('Local companion paired.')).toBeVisible()

  await page.getByRole('button', { name: 'Research' }).click()
  await expect(page.getByText(/Research run finished/)).toBeVisible()
  await expect(page.getByText('Timeline Planner')).toBeVisible()
  await expect(page.getByText(/wins for/)).toBeVisible()
  await expect(page.getByText(/Buffer \d+ min - Weather/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Lock item' }).first().click()
  await expect(page.getByText('Itinerary item locked and reoptimized.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unlock item' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Remove item' }).first().click()
  await expect(page.getByText('Itinerary item removed and reoptimized.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Replacement Suggestions' })).toBeVisible()
  await expect(page.getByText(/source-backed/).first()).toBeVisible()

  await page.getByRole('tab', { name: /Inspect/ }).click()
  await expect(page.getByRole('heading', { name: 'Candidate Inspector' })).toBeVisible()
  await page.getByRole('button', { name: 'Inspect' }).first().click()
  await expect(page.getByText('Candidate inspector loaded.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Manual Handoff' })).toBeVisible()
  await expect(page.getByText(/Allowed actions: open_provider_url, manual_verify/)).toBeVisible()

  await page.getByRole('tab', { name: /Budget/ }).click()
  await expect(page.getByText('Exact observed')).toBeVisible()

  await page.getByRole('tab', { name: /Monitors/ }).click()
  await expect(page.getByRole('heading', { name: 'Price Monitor Center' })).toBeVisible()
  await page.getByRole('button', { name: /Start monitor/ }).click()
  await expect(page.getByText('Price monitor active.')).toBeVisible()
  await expect(page.getByText(/Active - daily/)).toBeVisible()
  await page.getByRole('button', { name: /Stop monitor/ }).click()
  await expect(page.getByText('Price monitor stopped.')).toBeVisible()
  await expect(page.getByText(/Stopped - daily/)).toBeVisible()

  await page.getByRole('tab', { name: /Imports/ }).click()
  await expect(page.getByRole('heading', { name: 'Import Center' })).toBeVisible()
  await page.locator('input[name="bookingFile"]').setInputFiles({
    name: 'flight-scan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('image fixture bytes')
  })
  await page.getByLabel('OCR or booking text').fill('Flight Indigo 2026-07-04 INR 5400')
  await page.getByLabel('OCR confidence').fill('0.72')
  await page.getByRole('button', { name: /^Import$/ }).click()
  await expect(page.getByText('Import needs manual correction.')).toBeVisible()
  await expect(page.getByText(/Confidence 72% - Manual correction required/)).toBeVisible()
  await expect(page.getByText(/flight-scan\.png - image/)).toBeVisible()

  await page.getByRole('tab', { name: /Sources/ }).click()
  await expect(page.getByText(/local browser/).first()).toBeVisible()
  await expect(page.getByText('openmeteo').first()).toBeVisible()
  await expect(page.getByText('openstreetmap').first()).toBeVisible()
  await expect(page.getByText('Open source').first()).toBeVisible()
})

test('workspace has no serious automated accessibility violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
})
