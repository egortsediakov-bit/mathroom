import { createClient } from 'npm:@supabase/supabase-js@2'

const OPENAI_URL = 'https://api.openai.com/v1/responses'
const MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-6-luna'
const VALIDATOR_MODEL = Deno.env.get('OPENAI_VALIDATOR_MODEL') || MODEL
const te = new TextEncoder()

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowed = origin === 'https://mathroom.kotomatika.ru' || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://mathroom.kotomatika.ru',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) })
}

function clamp(v: number, a = 0, b = 1) { return Math.max(a, Math.min(b, v)) }
function normalized(s: string) { return String(s || '').toLocaleLowerCase('ru-RU').replace(/[\s\u00a0]+/g, ' ').replace(/[«»"'.,;:!?()[\]{}]/g, '').trim() }
async function sha256(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(normalized(s))))
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function outputText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()
  const parts: string[] = []
  for (const item of payload?.output || []) {
    for (const c of item?.content || []) if (typeof c?.text === 'string') parts.push(c.text)
  }
  return parts.join('\n').trim()
}

function parseJsonText(text: string) {
  let s = String(text || '').trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const firstObj = s.indexOf('{'), lastObj = s.lastIndexOf('}')
  if (firstObj >= 0 && lastObj > firstObj) s = s.slice(firstObj, lastObj + 1)
  return JSON.parse(s)
}

async function openai(prompt: string, model: string) {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('AI_NOT_CONFIGURED')
  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: prompt }],
      max_output_tokens: 12000
    })
  })
  if (!r.ok) throw new Error(`OPENAI_${r.status}: ${(await r.text()).slice(0, 800)}`)
  const data = await r.json()
  const text = outputText(data)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  return parseJsonText(text)
}

async function getContext(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!auth || !url || !anon) throw new Error('AUTH_REQUIRED')
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } }
  })
  const token = auth.replace(/^Bearer\s+/i, '')
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) throw new Error('AUTH_REQUIRED')
  return { client, user: data.user }
}

async function getJob(client: any, userId: string, jobId: string) {
  const { data, error } = await client.from('task_generation_jobs').select('*').eq('id', jobId).eq('teacher_id', userId).single()
  if (error || !data) throw new Error('JOB_NOT_FOUND')
  return data
}

async function updateJobCounts(client: any, jobId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await client.from('task_candidates').select('status').eq('job_id', jobId)
  if (error) throw error
  const rows = data || []
  const body = {
    ready_count: rows.filter((x: any) => x.status === 'ready').length,
    review_count: rows.filter((x: any) => x.status === 'review').length,
    rejected_count: rows.filter((x: any) => ['rejected','duplicate'].includes(x.status)).length,
    accepted_count: rows.filter((x: any) => x.status === 'accepted').length,
    updated_at: new Date().toISOString(),
    ...extra
  }
  const { error: upErr } = await client.from('task_generation_jobs').update(body).eq('id', jobId)
  if (upErr) throw upErr
}

async function acceptCandidate(client: any, userId: string, candidateId: string) {
  const { data: c, error } = await client.from('task_candidates').select('*').eq('id', candidateId).eq('teacher_id', userId).single()
  if (error || !c) throw new Error('CANDIDATE_NOT_FOUND')
  if (c.status === 'accepted' && c.exercise_id) return c.exercise_id
  if (c.status === 'duplicate') throw new Error('DUPLICATE_CANDIDATE')

  const { data: topic, error: topicErr } = await client.from('topics').select('id,grade,section,title').eq('id', c.topic_id).single()
  if (topicErr || !topic) throw new Error('TOPIC_NOT_FOUND')

  const tags = [...new Set(['ai-pipeline-v1', `класс-${topic.grade}`, `тема:${topic.title}`, ...(c.tags || [])])]
  const builderMeta = {
    version: 1,
    grade: topic.grade,
    task_type: c.task_type || 'standard',
    answers: [{ label: 'Ответ', value: c.answer || '', accepted: [] }],
    solution: c.solution || '',
    hints: [],
    source: { kind: 'ai', note: c.parent_exercise_id ? 'Похожая задача, созданная AI' : 'Создано AI по теме' },
    settings: { shared: false, allow_tests: true, allow_ai_example: true },
    pipeline: { candidate_id: c.id, job_id: c.job_id, confidence: Number(c.confidence || 0) }
  }
  const body = {
    teacher_id: userId,
    topic_id: c.topic_id,
    kind: 'task',
    title: `AI · ${topic.title}`,
    content: c.content,
    answer: c.answer || '',
    difficulty: c.difficulty || 'medium',
    category: c.category || '',
    tags,
    generator_spec: JSON.stringify({
      type: 'ai_pipeline_v1',
      candidate_id: c.id,
      job_id: c.job_id,
      parent_exercise_id: c.parent_exercise_id || null,
      confidence: Number(c.confidence || 0)
    }),
    generator_answer: '',
    favorite: false,
    builder_meta: builderMeta,
    is_draft: false,
    updated_at: new Date().toISOString()
  }
  const { data: ex, error: exErr } = await client.from('exercises').insert(body).select('id').single()
  if (exErr) throw exErr

  if (c.parent_exercise_id) {
    const { error: relErr } = await client.from('task_relations').insert({
      teacher_id: userId,
      parent_exercise_id: c.parent_exercise_id,
      child_exercise_id: ex.id,
      relation_type: 'variant'
    })
    if (relErr && relErr.code !== '23505') throw relErr
  }

  const { error: cErr } = await client.from('task_candidates').update({
    status: 'accepted',
    exercise_id: ex.id,
    updated_at: new Date().toISOString()
  }).eq('id', c.id).eq('teacher_id', userId)
  if (cErr) throw cErr
  await updateJobCounts(client, c.job_id)
  return ex.id
}

async function generate(client: any, userId: string, job: any) {
  if (!Deno.env.get('OPENAI_API_KEY')) throw new Error('AI_NOT_CONFIGURED')
  const { data: topic, error: topicErr } = await client.from('topics').select('id,grade,section,title,theory').eq('id', job.topic_id).single()
  if (topicErr || !topic) throw new Error('TOPIC_NOT_FOUND')

  let source: any = null
  if (job.mode === 'similar') {
    if (!job.source_exercise_id) throw new Error('SOURCE_EXERCISE_REQUIRED')
    const res = await client.from('exercises').select('id,title,content,answer,difficulty,category,builder_meta').eq('id', job.source_exercise_id).single()
    if (res.error || !res.data) throw new Error('SOURCE_EXERCISE_NOT_FOUND')
    source = res.data
  }

  const { data: existing } = await client.from('exercises')
    .select('id,content,answer,difficulty')
    .eq('topic_id', topic.id)
    .eq('kind', 'task')
    .limit(40)
  const existingRows = (existing || []).filter((x: any) => x.content).slice(0, 30)

  await client.from('task_generation_jobs').update({
    status: 'running', error_text: null, updated_at: new Date().toISOString()
  }).eq('id', job.id)

  const modeInstruction = job.mode === 'similar'
    ? `Создай новые задачи на ту же математическую идею, что и образец. Нельзя просто заменить имена и числа: меняй сюжет/формулировку/данные, но сохраняй проверяемый навык. Образец:\nУСЛОВИЕ: ${source.content}\nОТВЕТ: ${source.answer}\nРЕШЕНИЕ: ${source.builder_meta?.solution || ''}`
    : `Создай самостоятельные задачи строго по указанной школьной теме. Они должны покрывать немного разные поднавыки внутри темы.`

  const generationPrompt = `Ты создаёшь задачи для банка Mathroom. Нужен строгий JSON без markdown.
Класс: ${topic.grade}
Раздел: ${topic.section || 'Математика'}
Тема: ${topic.title}
Желаемая сложность: ${job.difficulty}
Количество: ${job.requested_count}
${modeInstruction}

Требования:
- каждая задача должна быть однозначной, полностью сформулированной и решаемой без внешнего контекста;
- правильный ответ обязан следовать из условия;
- решение должно быть коротким, но достаточным для независимой проверки;
- не используй спорные факты и не требуй изображений;
- для обычных вычислений task_type = "numeric" или "standard", для доказательных/объяснительных = "open";
- difficulty только basic, medium или advanced;
- не копируй дословно существующие формулировки.

Верни объект:
{"tasks":[{"content":"...","answer":"...","solution":"...","task_type":"standard","category":"...","difficulty":"medium"}]}`

  const generated = await openai(generationPrompt, MODEL)
  const tasks = Array.isArray(generated?.tasks) ? generated.tasks.slice(0, Number(job.requested_count)) : []
  if (!tasks.length) throw new Error('AI_NO_TASKS')

  const existingForPrompt = existingRows.slice(0, 20).map((x: any, i: number) => ({ i, content: String(x.content).slice(0, 700) }))
  const validationPrompt = `Ты независимый математический проверяющий. Не доверяй ответам генератора. Для каждой задачи реши её самостоятельно и оцени корректность. Верни только JSON без markdown.

Контекст: ${topic.grade} класс, тема "${topic.title}".
Кандидаты:
${JSON.stringify(tasks)}
Некоторые уже существующие задачи этой темы для поиска похожих дублей:
${JSON.stringify(existingForPrompt)}

Для каждого кандидата с index от 0:
- solved_answer: твой независимый ответ;
- answer_match: совпадает ли он по смыслу с заявленным ответом;
- well_posed: полное ли и однозначное условие;
- curriculum_fit: действительно ли задача подходит теме и классу;
- duplicate_risk: число 0..1, где 1 = почти дубликат существующей задачи или другого кандидата;
- quality_score: число 0..1 с учётом математической корректности, формулировки и педагогической адекватности;
- notes: короткий массив замечаний.

Формат:
{"results":[{"index":0,"solved_answer":"...","answer_match":true,"well_posed":true,"curriculum_fit":true,"duplicate_risk":0.05,"quality_score":0.97,"notes":[]}]}`

  const validation = await openai(validationPrompt, VALIDATOR_MODEL)
  const vr = Array.isArray(validation?.results) ? validation.results : []
  const existingNorm = new Set(existingRows.map((x: any) => normalized(x.content)))
  const inserted: any[] = []

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] || {}
    const v = vr.find((x: any) => Number(x?.index) === i) || {}
    const exactDuplicate = existingNorm.has(normalized(String(t.content || '')))
    const duplicateRisk = exactDuplicate ? 1 : clamp(Number(v.duplicate_risk ?? 0.35))
    const quality = clamp(Number(v.quality_score ?? 0.5))
    const answerMatch = v.answer_match === true
    const wellPosed = v.well_posed === true
    const curriculumFit = v.curriculum_fit === true
    const confidence = clamp(
      quality * 0.55 +
      (answerMatch ? 0.20 : 0) +
      (wellPosed ? 0.15 : 0) +
      (curriculumFit ? 0.10 : 0) -
      duplicateRisk * 0.25
    )
    let status = 'review'
    if (duplicateRisk >= 0.92) status = 'duplicate'
    else if (!answerMatch || !wellPosed || !curriculumFit || confidence < 0.75) status = 'rejected'
    else if (confidence >= 0.95) status = 'ready'

    const content = String(t.content || '').trim()
    if (!content) continue
    const row = {
      job_id: job.id,
      teacher_id: userId,
      topic_id: topic.id,
      parent_exercise_id: source?.id || null,
      content,
      answer: String(t.answer || '').trim(),
      solution: String(t.solution || '').trim(),
      difficulty: ['basic','medium','advanced'].includes(t.difficulty) ? t.difficulty : (job.difficulty === 'mixed' ? 'medium' : job.difficulty),
      task_type: ['standard','numeric','single','multiple','open'].includes(t.task_type) ? t.task_type : 'standard',
      category: String(t.category || topic.title || '').trim(),
      tags: ['ai-generated', job.mode === 'similar' ? 'ai-variant' : 'ai-topic'],
      confidence,
      status,
      validation: {
        solved_answer: String(v.solved_answer || ''),
        answer_match: answerMatch,
        well_posed: wellPosed,
        curriculum_fit: curriculumFit,
        duplicate_risk: duplicateRisk,
        quality_score: quality,
        notes: Array.isArray(v.notes) ? v.notes.slice(0, 8) : []
      },
      generation_meta: { model: MODEL, validator_model: VALIDATOR_MODEL, mode: job.mode },
      content_hash: await sha256(content)
    }
    const { data: c, error: cErr } = await client.from('task_candidates').insert(row).select('*').single()
    if (cErr) throw cErr

    const checks = [
      { candidate_id: c.id, teacher_id: userId, check_type: 'independent_solution', passed: Boolean(v.solved_answer), score: Boolean(v.solved_answer) ? 1 : 0, details: { solved_answer: String(v.solved_answer || '') } },
      { candidate_id: c.id, teacher_id: userId, check_type: 'answer_match', passed: answerMatch, score: answerMatch ? 1 : 0, details: { generated_answer: row.answer, solved_answer: String(v.solved_answer || '') } },
      { candidate_id: c.id, teacher_id: userId, check_type: 'quality', passed: wellPosed && curriculumFit && quality >= 0.75, score: quality, details: { well_posed: wellPosed, curriculum_fit: curriculumFit, notes: row.validation.notes } },
      { candidate_id: c.id, teacher_id: userId, check_type: 'duplicate', passed: duplicateRisk < 0.92, score: clamp(1 - duplicateRisk), details: { duplicate_risk: duplicateRisk, exact_duplicate: exactDuplicate } }
    ]
    const { error: chErr } = await client.from('task_candidate_checks').insert(checks)
    if (chErr) throw chErr
    inserted.push(c)
  }

  const counts = {
    ready: inserted.filter(x => x.status === 'ready').length,
    review: inserted.filter(x => x.status === 'review').length,
    rejected: inserted.filter(x => ['rejected','duplicate'].includes(x.status)).length
  }
  await client.from('task_generation_jobs').update({
    status: 'done',
    ready_count: counts.ready,
    review_count: counts.review,
    rejected_count: counts.rejected,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', job.id)
  return { job_id: job.id, generated: inserted.length, ...counts }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { client, user } = await getContext(req)
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'health')

    if (action === 'health') {
      return json(req, {
        ok: true,
        ai_configured: Boolean(Deno.env.get('OPENAI_API_KEY')),
        model: MODEL,
        validator_model: VALIDATOR_MODEL,
        pipeline_version: 1
      })
    }

    if (action === 'generate') {
      const job = await getJob(client, user.id, String(body?.job_id || ''))
      try {
        const result = await generate(client, user.id, job)
        return json(req, { ok: true, ...result })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await client.from('task_generation_jobs').update({
          status: 'failed',
          error_text: message,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', job.id)
        if (message === 'AI_NOT_CONFIGURED') return json(req, { ok: false, error: message }, 503)
        throw e
      }
    }

    if (action === 'accept') {
      const exerciseId = await acceptCandidate(client, user.id, String(body?.candidate_id || ''))
      return json(req, { ok: true, exercise_id: exerciseId })
    }

    if (action === 'accept_ready') {
      const jobId = String(body?.job_id || '')
      const job = await getJob(client, user.id, jobId)
      const { data, error } = await client.from('task_candidates').select('id').eq('job_id', job.id).eq('status', 'ready')
      if (error) throw error
      const ids: string[] = []
      for (const c of data || []) ids.push(await acceptCandidate(client, user.id, c.id))
      return json(req, { ok: true, accepted: ids.length, exercise_ids: ids })
    }

    if (action === 'reject') {
      const candidateId = String(body?.candidate_id || '')
      const { data: c, error: findErr } = await client.from('task_candidates').select('id,job_id').eq('id', candidateId).eq('teacher_id', user.id).single()
      if (findErr || !c) throw new Error('CANDIDATE_NOT_FOUND')
      const { error } = await client.from('task_candidates').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) throw error
      await updateJobCounts(client, c.job_id)
      return json(req, { ok: true })
    }

    return json(req, { error: 'UNKNOWN_ACTION' }, 400)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message === 'AUTH_REQUIRED' ? 401 : message.endsWith('_NOT_FOUND') ? 404 : 500
    console.error('[task-pipeline]', message)
    return json(req, { ok: false, error: message }, status)
  }
})
