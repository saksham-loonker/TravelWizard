import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { config as loadEnv } from 'dotenv'
import { createJobStore } from '@travelwizard/domain'

loadEnv({ path: new URL('../../../.env', import.meta.url) })
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6381'
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
const jobStore = createJobStore()

export const researchQueue = new Queue('travelwizard-research', { connection })
export const ocrQueue = new Queue('travelwizard-ocr', { connection })
export const solveQueue = new Queue('travelwizard-solve', { connection })
export const monitorQueue = new Queue('travelwizard-monitor', { connection })

const workers = [
  new Worker(
    'travelwizard-research',
    async (job) => {
      const record = jobStore.create({ tripId: String(job.data.tripId), kind: 'research', phase: 'source_plan' })
      jobStore.progress(record.id, 40, 'provider_policy')
      jobStore.progress(record.id, 80, 'normalize_sources')
      return jobStore.progress(record.id, 100, 'complete', 0.01)
    },
    { connection }
  ),
  new Worker(
    'travelwizard-ocr',
    async (job) => {
      const record = jobStore.create({ tripId: String(job.data.tripId), kind: 'ocr', phase: 'redact_and_parse' })
      return jobStore.progress(record.id, 100, 'manual_verification_gate', 0)
    },
    { connection }
  ),
  new Worker(
    'travelwizard-solve',
    async (job) => {
      const record = jobStore.create({ tripId: String(job.data.tripId), kind: 'solve', phase: 'critique_repair' })
      return jobStore.progress(record.id, 100, 'variants_ready', 0.005)
    },
    { connection }
  ),
  new Worker(
    'travelwizard-monitor',
    async (job) => {
      const record = jobStore.create({ tripId: String(job.data.tripId), kind: 'monitor', phase: 'explicit_user_monitor' })
      return jobStore.progress(record.id, 100, 'manual_verify_price', 0)
    },
    { connection }
  )
]

for (const worker of workers) {
  worker.on('failed', (job, error) => {
    console.error(`Worker job ${job?.id ?? 'unknown'} failed: ${error.message}`)
  })
}

process.stdout.write(`TravelWizard worker connected to ${redactConnectionString(redisUrl)}\n`)

function redactConnectionString(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.username) parsed.username = 'redacted'
    if (parsed.password) parsed.password = 'redacted'
    return parsed.toString()
  } catch {
    return value.replace(/:\/\/[^:@\s]+:[^@\s]+@/, '://redacted:redacted@')
  }
}
