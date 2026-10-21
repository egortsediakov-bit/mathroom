import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || ''
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const body = await req.json().catch(() => ({}))
    const filePath = String(body?.file_path || '')
    const lessonId = String(body?.lesson_id || '')
    const accessToken = String(body?.access_token || '')

    if (!filePath) return Response.json({ ok:false, error:'file_path_required' }, { status:400 })

    let allowed = false
    const authHeader = req.headers.get('authorization') || ''

    if (authHeader && anonKey) {
      const client = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false }
      })
      const { data } = await client.auth.getUser()
      const uid = data?.user?.id || ''
      if (uid && !data?.user?.is_anonymous) {
        if (lessonId) {
          const { data: lesson } = await admin.from('lessons').select('teacher_id').eq('id',lessonId).maybeSingle()
          allowed = String(lesson?.teacher_id || '') === uid
        } else {
          const { data: teacher } = await admin.from('teachers').select('id,access_enabled').eq('id',uid).maybeSingle()
          allowed = !!teacher?.access_enabled
        }
      }
    }

    if (!allowed && lessonId && accessToken.length >= 8) {
      const { data: lesson } = await admin
        .from('lessons')
        .select('student_id,status,students!inner(access_token)')
        .eq('id',lessonId)
        .maybeSingle()
      const studentToken = String((lesson as any)?.students?.access_token || '')
      allowed = !!lesson && studentToken === accessToken && String((lesson as any)?.status || '') !== 'cancelled'
    }

    if (!allowed) return Response.json({ ok:false, error:'forbidden' }, { status:403 })

    const { data: book } = await admin
      .from('textbooks')
      .select('id,teacher_id,is_shared,file_path')
      .eq('file_path',filePath)
      .maybeSingle()
    if (!book) return Response.json({ ok:false, error:'textbook_not_found' }, { status:404 })

    if (lessonId && !book.is_shared) {
      const { data: lesson } = await admin.from('lessons').select('teacher_id').eq('id',lessonId).maybeSingle()
      if (String(lesson?.teacher_id || '') !== String(book.teacher_id || '')) {
        return Response.json({ ok:false, error:'textbook_not_available_for_lesson' }, { status:403 })
      }
    }

    const { data, error } = await admin.storage.from('textbooks').createSignedUrl(filePath, 3600)
    if (error || !data?.signedUrl) throw error || new Error('signed_url_failed')

    return Response.json({ ok:true, signed_url:data.signedUrl, expires_in:3600 })
  } catch (e) {
    console.error(e)
    return Response.json({ ok:false, error:String((e as any)?.message || e) }, { status:500 })
  }
})
