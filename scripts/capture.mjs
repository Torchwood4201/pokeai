import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright')
const require = createRequire(join(runtime, 'package.json'))
const { chromium } = require('playwright')
try {
  const captures = require(join(process.env.RUNTIME_DIR || '/home/runner/work/_temp/omgithub-runtime', 'scripts/wip-screenshots.cjs'))
  captures.instrument({ chromium })
} catch (error) {
  console.warn(`[capture] screenshot instrumentation unavailable: ${error.message}`)
}

const configPath = join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (process.platform === 'linux') {
  process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim()
}

const url = process.env.CAPTURE_URL
const output = process.env.CAPTURE_DIR
if (!url || !output) {
  console.error('[capture] CAPTURE_URL and CAPTURE_DIR are required')
  process.exit(1)
}
mkdirSync(output, { recursive: true })
const outputDir = resolve(output)

const transient = (error) => Object.assign(error, { exitCode: 75 })
const isTransientNavigation = (error) =>
  error?.name === 'TimeoutError' ||
  /net::|ERR_|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(String(error?.message || error))

async function timed(label, fn) {
  const started = Date.now()
  try {
    return await fn()
  } finally {
    console.log(`[capture] ${label} ${Date.now() - started}ms`)
  }
}

function assertRendered(path, name) {
  const size = statSync(path).size
  if (size < 12_000) throw new Error(`${name} screenshot is too small (${size} bytes); page did not render`)
  console.log(`[capture] ${name} screenshot ${size} bytes`)
}

let browser
try {
  browser = await timed('launch', () =>
    chromium.launch({ ...config.browser.launchOptions, timeout: 30_000 }).catch((error) => {
      throw transient(error)
    })
  )

  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await timed(`${name}:new-page`, () =>
      browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
        isMobile: name === 'mobile',
        hasTouch: name === 'mobile'
      }).catch((error) => {
        throw transient(error)
      })
    )
    page.setDefaultTimeout(30_000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    const response = await timed(`${name}:navigate`, async () => {
      try {
        return await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
      } catch (error) {
        if (isTransientNavigation(error)) throw transient(error)
        throw error
      }
    })
    if (!response || !response.ok()) {
      const status = response?.status()
      if (!response || status === 408 || status === 429 || status >= 500) {
        throw transient(new Error(`HTTP ${status ?? 'no response'} loading ${url}`))
      }
      throw new Error(`HTTP ${status} loading ${url}`)
    }

    await timed(`${name}:ready`, async () => {
      await page.locator('#game').waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30_000 })
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30_000 })
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#game')
        if (!canvas) return false
        const context = canvas.getContext('2d')
        if (!context) return false
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        const colors = new Set()
        for (let i = 0; i < data.length; i += 16) {
          colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
          if (colors.size > 24) return true
        }
        return false
      }, null, { timeout: 30_000 })
      const heading = (await page.locator('h1').innerText()).trim()
      if (!heading) throw new Error('headline did not render')
      if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)
    })

    await page.waitForTimeout(1400)
    const file = join(outputDir, `final-${name}.png`)
    await timed(`${name}:screenshot`, () =>
      page.screenshot({ path: file, timeout: 30_000 }).catch((error) => {
        if (error.name === 'TimeoutError' || !browser.isConnected()) throw transient(error)
        throw error
      })
    )
    assertRendered(file, name)
    await timed(`${name}:close`, () => page.close())
  }
  console.log('[capture] final-desktop.png and final-mobile.png are ready')
} catch (error) {
  console.error(`[capture] ${error.message}`)
  process.exitCode = error.exitCode || 1
} finally {
  if (browser) {
    await timed('close-browser', () => browser.close().catch((error) => {
      console.error(`[capture] browser close failed: ${error.message}`)
      process.exitCode ||= 75
    }))
  }
}
