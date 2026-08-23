import { rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createServer as createNetServer } from 'node:net'

const root = process.cwd()
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const secret = 'test-local-companion-secret-0001'
const stateFile = join(root, 'storage', 'e2e-state.json')
const serverChildren = []
let closing = false
const companionPort = await getAvailablePort(4317)
const webPort = await getAvailablePort(3210)
const companionUrl = `http://127.0.0.1:${companionPort}`
const webUrl = `http://127.0.0.1:${webPort}`

rmSync(stateFile, { force: true })
rmSync(join(root, 'test-results'), { recursive: true, force: true })
rmSync(join(root, 'playwright-report'), { recursive: true, force: true })

startServer(['--filter', '@travelwizard/local-companion', 'dev'], {
  LOCAL_COMPANION_SECRET: secret,
  LOCAL_COMPANION_PORT: String(companionPort),
  APP_ORIGIN: webUrl
})

startServer(['--filter', '@travelwizard/web', 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], {
  LOCAL_COMPANION_SECRET: secret,
  LOCAL_COMPANION_URL: companionUrl,
  TRAVELWIZARD_STATE_FILE: stateFile
})

try {
  await waitForUrl(`${companionUrl}/health`, 120_000)
  await waitForUrl(webUrl, 120_000)
  await waitForUrl(`${webUrl}/api/trips`, 120_000)
  const exitCode = await runPlaywright(webUrl)
  close(exitCode)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  close(1)
}

function startServer(args, env) {
  const child = spawn(pnpm, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...env
    }
  })
  serverChildren.push(child)
  child.stdout?.on('data', (chunk) => {
    if (!closing) process.stdout.write(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    if (!closing) process.stderr.write(chunk)
  })
  child.on('exit', (code) => {
    if (!closing && code && code !== 0) {
      console.error(`Server command failed: ${pnpm} ${args.join(' ')}`)
      close(code)
    }
  })
}

function runPlaywright(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(pnpm, ['exec', 'playwright', 'test', '--config', 'playwright.config.ts'], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        BASE_URL: baseUrl
      }
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function getAvailablePort(preferredPort) {
  const preferred = await tryPort(preferredPort)
  if (preferred) return preferred
  const fallback = await tryPort(0)
  if (fallback) return fallback
  throw new Error('Unable to find an available localhost port.')
}

function tryPort(port) {
  return new Promise((resolve) => {
    const server = createNetServer()
    server.unref()
    server.once('error', () => resolve(null))
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const resolvedPort = typeof address === 'object' && address ? address.port : port
      server.close(() => resolve(resolvedPort))
    })
  })
}

function close(code = 0) {
  if (closing) return
  closing = true
  const cleanupTasks = []
  for (const child of serverChildren) {
    if (!child.pid || child.killed) continue
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      cleanupTasks.push(new Promise((resolve) => {
        killer.once('exit', resolve)
        killer.once('error', resolve)
      }))
      continue
    }
    child.kill('SIGTERM')
  }
  Promise.race([
    Promise.all(cleanupTasks),
    new Promise((resolve) => setTimeout(resolve, 2_500))
  ]).finally(() => process.exit(code))
}

process.on('SIGINT', () => close(130))
process.on('SIGTERM', () => close(143))
process.on('SIGHUP', () => close(129))
