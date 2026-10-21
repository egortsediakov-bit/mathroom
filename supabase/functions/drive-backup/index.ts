import { createClient } from 'npm:@supabase/supabase-js@2'

const TABLES = [
  'teachers','students','student_sessions','topics','exercises','lessons','board_pages',
  'lesson_board_versions','homeworks','homework_items','tests','test_items','board_templates',
  'lesson_queue_items','lesson_live_state','lesson_templates','lesson_events','lesson_reports',
  'student_goals','lesson_plans','parent_reports','student_review_items','homework_attempts','student_topic_mastery',
  'student_learning_roadmaps','student_alert_snoozes','student_progress_snapshots','student_readiness_targets','student_target_trajectories',
  'student_questions','student_resources','student_lesson_checkins','student_schedule_requests',
  'textbooks','textbook_topic_links','teacher_textbook_library','shared_materials',
  'task_bank_sources','task_bank_items','task_bank_runs'
]

const STORAGE_BUCKETS = ['board-assets','textbooks']
const te = new TextEncoder()

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

async function sha256Hex(data: Uint8Array | string) {
  const bytes = typeof data === 'string' ? te.encode(data) : data
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map(x => x.toString(16).padStart(2, '0')).join('')
}

async function importBackupKey() {
  const keyRaw = b64ToBytes(Deno.env.get('BACKUP_ENCRYPTION_KEY_B64') || '')
  if (keyRaw.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes')
  }
  return crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt'])
}

async function encryptBytes(bytes: Uint8Array, magicText: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  return concat(te.encode(magicText), iv, cipher)
}

async function encryptGzipJson(value: unknown, key: CryptoKey) {
  const json = JSON.stringify(value)
  const gzip = new Uint8Array(await new Response(
    new Blob([te.encode(json)]).stream().pipeThrough(new CompressionStream('gzip'))
  ).arrayBuffer())
  return {
    bytes: await encryptBytes(gzip, 'MATHROOM1', key),
    json,
    rawSha256: await sha256Hex(json)
  }
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

async function createDriveFolder(name: string, parent: string, accessToken: string) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,createdTime', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      parents: [parent],
      mimeType: 'application/vnd.google-apps.folder'
    })
  })
  if (!r.ok) throw new Error(`Drive folder error: ${await r.text()}`)
  return await r.json()
}

async function uploadDrive(
  bytes: Uint8Array,
  filename: string,
  parent: string,
  accessToken: string,
  mimeType = 'application/octet-stream'
) {
  const boundary = `mathroom_${crypto.randomUUID()}`
  const meta = JSON.stringify({ name: filename, parents: [parent], mimeType })
  const head = te.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  )
  const tail = te.encode(`\r\n--${boundary}--`)
  const body = concat(head, bytes, tail)

  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  )
  if (!r.ok) throw new Error(`Drive upload error (${filename}): ${await r.text()}`)
  return await r.json()
}

function isFolder(item: any) {
  return !item?.id && !item?.metadata
}

async function listStorageRecursive(admin: any, bucket: string) {
  const files: any[] = []
  const queue = ['']
  while (queue.length) {
    const prefix = queue.shift()!
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      })
      if (error) throw new Error(`Storage list error (${prefix || '/'}): ${error.message}`)
      const rows = data || []
      for (const item of rows) {
        const full = prefix ? `${prefix}/${item.name}` : item.name
        if (isFolder(item)) queue.push(full)
        else files.push({ ...item, fullPath: full })
      }
      if (rows.length < 1000) break
    }
  }
  return files
}

function safeDriveName(s: string) {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150)
}

async function archiveChangedAssets(
  admin: any,
  key: CryptoKey,
  accessToken: string,
  runFolderId: string,
  bucket: string
) {
  const current = await listStorageRecursive(admin, bucket)
  const trackedRows = await allRows(admin, 'backup_storage_items')
  const tracked = new Map(trackedRows.filter((x: any) => x.bucket_id === bucket).map((x: any) => [x.object_name, x]))
  let archived = 0

  for (const item of current) {
    const updatedAt = item.updated_at || item.created_at || new Date(0).toISOString()
    const size = Number(item.metadata?.size || 0)
    const mime = item.metadata?.mimetype || item.metadata?.contentType || 'application/octet-stream'
    const old: any = tracked.get(item.fullPath)
    const unchanged = old && new Date(old.object_updated_at).getTime() === new Date(updatedAt).getTime() && Number(old.object_size || 0) === size
    if (unchanged) continue

    const { data, error } = await admin.storage.from(bucket).download(item.fullPath)
    if (error || !data) throw new Error(`Storage download error (${item.fullPath}): ${error?.message || 'empty response'}`)
    const raw = new Uint8Array(await data.arrayBuffer())
    const rawSha256 = await sha256Hex(raw)
    const encrypted = await encryptBytes(raw, 'MATHASST1', key)
    const base = safeDriveName(item.name || item.fullPath.split('/').pop() || 'asset.bin')
    const marker = String(item.id || rawSha256.slice(0, 16)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    const driveName = `asset-${marker}-${base}.enc`
    const driveFile = await uploadDrive(encrypted, driveName, runFolderId, accessToken)

    const row = {
      bucket_id: bucket,
      object_name: item.fullPath,
      object_updated_at: updatedAt,
      object_size: raw.length,
      object_mime_type: mime,
      raw_sha256: rawSha256,
      drive_file_id: driveFile.id,
      drive_run_folder_id: runFolderId,
      archived_at: new Date().toISOString()
    }
    const { error: upsertError } = await admin.from('backup_storage_items').upsert(row, { onConflict: 'bucket_id,object_name' })
    if (upsertError) throw upsertError
    tracked.set(item.fullPath, row)
    archived++
  }

  const manifestItems = current.map(item => {
    const row: any = tracked.get(item.fullPath)
    return {
      path: item.fullPath,
      object_id: item.id || null,
      updated_at: item.updated_at || item.created_at || null,
      size: Number(item.metadata?.size || row?.object_size || 0),
      mime_type: item.metadata?.mimetype || item.metadata?.contentType || row?.object_mime_type || null,
      raw_sha256: row?.raw_sha256 || null,
      drive_file_id: row?.drive_file_id || null,
      drive_run_folder_id: row?.drive_run_folder_id || null,
      archived_at: row?.archived_at || null
    }
  })

  const missingRefs = manifestItems.filter(x => !x.drive_file_id)
  if (missingRefs.length) throw new Error(`Storage manifest has ${missingRefs.length} object(s) without Drive archive reference`)

  return { total: current.length, archived, unchanged: current.length - archived, items: manifestItems }
}

function collectAssetPaths(value: any, out = new Set<string>()) {
  if (!value) return out
  if (Array.isArray(value)) {
    for (const item of value) collectAssetPaths(item, out)
    return out
  }
  if (typeof value === 'object') {
    if (typeof value.assetPath === 'string' && value.assetPath && !value.assetPath.startsWith('mr-textbook-page:') && !value.assetPath.startsWith('mr-local-asset:')) {
      out.add(value.assetPath)
    }
    for (const v of Object.values(value)) collectAssetPaths(v, out)
  }
  return out
}

async function cleanupOrphanBoardAssets(admin: any, tables: Record<string, unknown[]>) {
  const refs = new Set<string>()
  collectAssetPaths(tables.board_pages || [], refs)
  collectAssetPaths(tables.board_templates || [], refs)

  const current = await listStorageRecursive(admin, 'board-assets')
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const stale = current.filter((item: any) => {
    if (refs.has(item.fullPath)) return false
    const ts = new Date(item.updated_at || item.created_at || 0).getTime()
    return Number.isFinite(ts) && ts > 0 && ts < cutoff
  })
  let removed = 0
  for (let i = 0; i < stale.length; i += 100) {
    const paths = stale.slice(i, i + 100).map((x: any) => x.fullPath)
    const { error } = await admin.storage.from('board-assets').remove(paths)
    if (error) throw new Error(`Storage cleanup failed: ${error.message}`)
    removed += paths.length
  }
  return { scanned: current.length, referenced: refs.size, stale: stale.length, removed }
}

async function markRun(admin: any, runId: string, values: Record<string, unknown>) {
  const { error } = await admin.from('backup_runs').update(values).eq('run_id', runId)
  if (error) console.error(`[backup:${runId}] unable to update backup_runs`, error)
}

async function runBackup(runId: string) {
  const startedAt = new Date()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    console.log(`[backup:${runId}] started`)
    const { error: insertError } = await admin.from('backup_runs').insert({ run_id: runId, started_at: startedAt.toISOString(), status: 'running' })
    if (insertError) throw insertError

    const rootFolder = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID')
    if (!rootFolder) throw new Error('GOOGLE_DRIVE_FOLDER_ID is missing')

    const accessToken = await googleAccessToken()
    const key = await importBackupKey()
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
    const runFolder = await createDriveFolder(`mathroom-${stamp}`, rootFolder, accessToken)
    await markRun(admin, runId, { drive_folder_id: runFolder.id })

    const tables: Record<string, unknown[]> = {}
    const tableCounts: Record<string, number> = {}
    let rowsCount = 0
    for (const name of TABLES) {
      const rows = await allRows(admin, name)
      tables[name] = rows
      tableCounts[name] = rows.length
      rowsCount += rows.length
    }

    const dbPayload = {
      format: 'mathroom-backup',
      version: 3,
      run_id: runId,
      created_at: startedAt.toISOString(),
      tables
    }
    const dbEncrypted = await encryptGzipJson(dbPayload, key)
    const dbFile = await uploadDrive(dbEncrypted.bytes, 'database.json.gz.enc', runFolder.id, accessToken)
    await markRun(admin, runId, {
      database_file_id: dbFile.id,
      tables_count: TABLES.length,
      rows_count: rowsCount
    })

    const storageByBucket: Record<string, any> = {}
    let storageObjectsTotal = 0
    let storageObjectsArchived = 0
    for (const bucket of STORAGE_BUCKETS) {
      const result = await archiveChangedAssets(admin, key, accessToken, runFolder.id, bucket)
      storageByBucket[bucket] = result
      storageObjectsTotal += result.total
      storageObjectsArchived += result.archived
    }

    const manifestPayload = {
      format: 'mathroom-backup-manifest',
      version: 2,
      run_id: runId,
      created_at: startedAt.toISOString(),
      database: {
        drive_file_id: dbFile.id,
        file_name: 'database.json.gz.enc',
        plaintext_sha256: dbEncrypted.rawSha256,
        table_counts: tableCounts,
        rows_total: rowsCount
      },
      storage: Object.fromEntries(
        Object.entries(storageByBucket).map(([bucket,result]: any) => [bucket,{
          total_current_objects: result.total,
          archived_this_run: result.archived,
          unchanged_reused_from_previous_archives: result.unchanged,
          objects: result.items
        }])
      )
    }
    const manifestEncrypted = await encryptGzipJson(manifestPayload, key)
    const manifestFile = await uploadDrive(manifestEncrypted.bytes, 'manifest.json.gz.enc', runFolder.id, accessToken)

    const success = {
      format: 'mathroom-backup-success',
      version: 2,
      status: 'complete',
      run_id: runId,
      created_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      database_file_id: dbFile.id,
      manifest_file_id: manifestFile.id,
      database_plaintext_sha256: dbEncrypted.rawSha256,
      manifest_plaintext_sha256: manifestEncrypted.rawSha256,
      tables: TABLES.length,
      rows: rowsCount,
      storage_objects_total: storageObjectsTotal,
      storage_objects_archived_this_run: storageObjectsArchived,
      storage_buckets: STORAGE_BUCKETS
    }
    const successBytes = te.encode(JSON.stringify(success, null, 2))
    await uploadDrive(successBytes, '_SUCCESS.json', runFolder.id, accessToken, 'application/json')

    let cleanup = { scanned: 0, referenced: 0, stale: 0, removed: 0 }
    try {
      cleanup = await cleanupOrphanBoardAssets(admin, tables)
      console.log(`[backup:${runId}] orphan cleanup removed=${cleanup.removed} stale=${cleanup.stale}`)
    } catch (cleanupError) {
      console.error(`[backup:${runId}] orphan cleanup failed`, cleanupError)
    }

    await markRun(admin, runId, {
      finished_at: new Date().toISOString(),
      status: 'success',
      manifest_file_id: manifestFile.id,
      assets_total: storageObjectsTotal,
      assets_archived: storageObjectsArchived,
      tables_count: TABLES.length,
      rows_count: rowsCount,
      error: null
    })

    console.log(`[backup:${runId}] completed folder=${runFolder.id} rows=${rowsCount} storage=${storageObjectsTotal} archived=${storageObjectsArchived}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[backup:${runId}] failed`, e)
    await markRun(admin, runId, {
      finished_at: new Date().toISOString(),
      status: 'failed',
      error: message
    })
  }
}

Deno.serve((req) => {
  const expected = Deno.env.get('BACKUP_CRON_SECRET') || ''
  if (!expected || req.headers.get('x-backup-secret') !== expected) {
    return new Response('Forbidden', { status: 403 })
  }

  const runId = crypto.randomUUID()
  EdgeRuntime.waitUntil(runBackup(runId))

  return Response.json(
    { ok: true, accepted: true, run_id: runId, backup_version: 3, storage_archive: true, storage_buckets: STORAGE_BUCKETS },
    { status: 202 }
  )
})
