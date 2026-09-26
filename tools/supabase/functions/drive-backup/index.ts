import { createClient } from 'npm:@supabase/supabase-js@2'

const TABLES = [
  'teachers','students','student_sessions','topics','exercises','lessons','board_pages',
  'lesson_board_versions','homeworks','homework_items','tests','test_items','board_templates',
  'lesson_queue_items','lesson_live_state'
]

async function allRows(client: any, table: string) {
  const out: any[] = []
  for (let from = 0;; from += 1000) {
    const { data, error } = await client.from(table).select('*').range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

function b64ToBytes(s: string) {
  const raw = atob(s)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

function concat(...chunks: Uint8Array[]) {
  const total = chunks.reduce((n, x) => n + x.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

async function encryptGzip(json: string, keyB64: string) {
  const gzip = await new Response(
    new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('gzip'))
  ).arrayBuffer()

  const keyRaw = b64ToBytes(keyB64)
  if (keyRaw.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes')
  }

  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gzip)
  )
  const magic = new TextEncoder().encode('MATHROOM1')
  return concat(magic, iv, cipher)
}

async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: Deno.env.get('GOOGLE_CLIENT_ID') || '',
    client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '',
    refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN') || '',
    grant_type: 'refresh_token'
  })

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })

  if (!r.ok) throw new Error(`Google token error: ${await r.text()}`)
  return (await r.json()).access_token as string
}

async function uploadDrive(bytes: Uint8Array, filename: string, accessToken: string) {
  const folder = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID')
  if (!folder) throw new Error('GOOGLE_DRIVE_FOLDER_ID is missing')

  const boundary = `mathroom_${crypto.randomUUID()}`
  const meta = JSON.stringify({
    name: filename,
    parents: [folder],
    mimeType: 'application/octet-stream'
  })

  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
  )
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`)
  const body = concat(head, bytes, tail)

  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  )

  if (!r.ok) throw new Error(`Drive upload error: ${await r.text()}`)
  return await r.json()
}

async function runBackup(runId: string) {
  try {
    console.log(`[backup:${runId}] started`)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false }
    })

    const tables: Record<string, unknown[]> = {}
    for (const name of TABLES) {
      tables[name] = await allRows(admin, name)
    }

    const now = new Date()
    const payload = JSON.stringify({
      format: 'mathroom-backup',
      version: 1,
      created_at: now.toISOString(),
      tables
    })

    const encrypted = await encryptGzip(
      payload,
      Deno.env.get('BACKUP_ENCRYPTION_KEY_B64') || ''
    )

    const stamp = now.toISOString().replace(/[:.]/g, '-')
    const accessToken = await googleAccessToken()
    const file = await uploadDrive(
      encrypted,
      `mathroom-backup-${stamp}.json.gz.enc`,
      accessToken
    )

    console.log(`[backup:${runId}] completed`, JSON.stringify(file))
  } catch (e) {
    console.error(`[backup:${runId}] failed`, e)
  }
}

Deno.serve((req) => {
  const expected = Deno.env.get('BACKUP_CRON_SECRET') || ''

  if (!expected || req.headers.get('x-backup-secret') !== expected) {
    return new Response('Forbidden', { status: 403 })
  }

  const runId = crypto.randomUUID()

  // Important: acknowledge the cron request immediately so pg_net's 5-second
  // timeout does not cancel/wait on the Google Drive backup operation.
  EdgeRuntime.waitUntil(runBackup(runId))

  return Response.json(
    { ok: true, accepted: true, run_id: runId },
    { status: 202 }
  )
})
