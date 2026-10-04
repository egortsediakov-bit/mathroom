/* Mathroom v29.9.0 — make the generated 1–11 task bank idempotent and clean duplicate seed rows. */
(() => {
  'use strict';

  const bank = window.MathroomCurriculumBank;
  if (!bank || bank.__idempotent2990) return;

  const VERSION = '29.9.0';
  const BANK_TAG = bank.BANK_TAG || 'mathroom-core-bank-v1';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom bank 29.9.0]', m); };

  let cleanupPromise = null;
  let coreCount = null;
  let lastCoreCountAt = 0;

  const seedKey = row => {
    for (const tag of (row?.tags || [])) {
      const s = String(tag || '');
      if (/^mrseed:[^:]+:\d+$/.test(s)) return s;
    }
    return '';
  };

  async function teacherId(c) {
    if (S()?.user?.id) return S().user.id;
    try {
      const { data: { user } } = await c.auth.getUser();
      return user?.id || null;
    } catch { return null; }
  }

  async function fetchCoreRows(c, uid) {
    const out = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await c.from('exercises')
        .select('id,teacher_id,topic_id,kind,title,content,answer,difficulty,category,tags,created_at')
        .eq('teacher_id', uid)
        .contains('tags', [BANK_TAG])
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      const rows = data || [];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  async function exactCoreCount({ force = false } = {}) {
    if (!force && coreCount != null && Date.now() - lastCoreCountAt < 10000) return coreCount;
    const c = sb(); if (!c) return null;
    const uid = await teacherId(c); if (!uid) return null;
    const { count, error } = await c.from('exercises')
      .select('*', { count: 'exact', head: true })
      .eq('teacher_id', uid)
      .eq('kind', 'task')
      .contains('tags', [BANK_TAG]);
    if (error) throw error;
    coreCount = Number(count) || 0;
    lastCoreCountAt = Date.now();
    return coreCount;
  }

  function patchCoreBadge() {
    if (coreCount == null || !document.getElementById('bankList')) return;
    const pills = [...document.querySelectorAll('.bank-summary .pill')];
    if (pills[1]) pills[1].textContent = `${coreCount} из готовой базы`;
  }

  async function refreshBadges({ force = false } = {}) {
    try { await exactCoreCount({ force }); } catch (e) { console.warn('[Mathroom 29.9.0 core count]', e); }
    patchCoreBadge();
    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}
  }

  async function deleteIdsSafely(c, uid, ids) {
    let removed = 0, blocked = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await c.from('exercises')
        .delete()
        .eq('teacher_id', uid)
        .in('id', chunk);
      if (!error) { removed += chunk.length; continue; }

      // If one row is referenced somewhere, do not sacrifice the rest of the cleanup.
      for (const id of chunk) {
        const { error: oneError } = await c.from('exercises')
          .delete()
          .eq('teacher_id', uid)
          .eq('id', id);
        if (oneError) blocked++; else removed++;
      }
    }
    return { removed, blocked };
  }

  async function cleanupDuplicates({ silent = false } = {}) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const c = sb();
      if (!c) return { removed: 0, blocked: 0, duplicateKeys: 0, rows: 0 };
      const uid = await teacherId(c);
      if (!uid) return { removed: 0, blocked: 0, duplicateKeys: 0, rows: 0 };

      const rows = await fetchCoreRows(c, uid);
      const bySeed = new Map();
      for (const row of rows) {
        const key = seedKey(row);
        if (!key) continue;
        if (!bySeed.has(key)) bySeed.set(key, []);
        bySeed.get(key).push(row);
      }

      const duplicateIds = [];
      let duplicateKeys = 0;
      for (const list of bySeed.values()) {
        if (list.length <= 1) continue;
        duplicateKeys++;
        // Oldest generated row is canonical. Later rows were created by the pagination bug.
        list.sort((a,b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        duplicateIds.push(...list.slice(1).map(x => x.id).filter(Boolean));
      }

      const result = duplicateIds.length
        ? await deleteIdsSafely(c, uid, duplicateIds)
        : { removed: 0, blocked: 0 };

      if (result.removed && Array.isArray(S().exercises)) {
        const removedSet = new Set(duplicateIds.map(String));
        S().exercises = S().exercises.filter(x => !removedSet.has(String(x.id)));
      }

      coreCount = null; lastCoreCountAt = 0;
      await refreshBadges({ force: true });

      if (!silent && (result.removed || result.blocked)) {
        toast(`Готовая база очищена: удалено дублей ${result.removed}${result.blocked ? `, не удалось удалить ${result.blocked} используемых задач` : ''}.`);
      }
      return { ...result, duplicateKeys, rows: rows.length };
    })().finally(() => { cleanupPromise = null; });
    return cleanupPromise;
  }

  const originalSeed = bank.seed.bind(bank);
  async function seedFixed(args = {}) {
    const c = args.sb || sb();
    const uid = args.teacherId || (c ? await teacherId(c) : null);
    if (!c || !uid) return originalSeed(args);

    // First remove historical duplicates, then pass the COMPLETE generated bank to v282.
    // v282 previously saw only S.exercises (Supabase's first 1000 rows), so after 1000 rows
    // it believed older mrseed keys were missing and inserted them again on every refresh.
    await cleanupDuplicates({ silent: true });
    const allCore = await fetchCoreRows(c, uid);
    const merged = new Map();
    for (const row of [...(args.exercises || []), ...allCore]) {
      if (row?.id) merged.set(String(row.id), row);
      else merged.set(`anon:${merged.size}`, row);
    }
    const result = await originalSeed({ ...args, sb: c, teacherId: uid, exercises: [...merged.values()] });
    coreCount = null; lastCoreCountAt = 0;
    await refreshBadges({ force: true });
    return result;
  }

  window.MathroomCurriculumBank = {
    ...bank,
    seed: seedFixed,
    __idempotent2990: true,
    idempotentVersion: VERSION
  };

  window.MathroomCurriculumIdempotentV2990 = {
    version: VERSION,
    cleanupDuplicates,
    fetchCoreRows,
    exactCoreCount,
    refreshBadges
  };

  // Clean the already accumulated duplicates once the teacher session is ready.
  let tries = 0;
  const boot = setInterval(async () => {
    tries++;
    const c = sb();
    const uid = c ? await teacherId(c) : null;
    if (!c || !uid) {
      if (tries > 30) clearInterval(boot);
      return;
    }
    clearInterval(boot);
    try {
      const r = await cleanupDuplicates({ silent: true });
      if (r.removed) toast(`Исправлен счётчик банка: удалено ${r.removed} дублей готовой базы.`);
      await refreshBadges({ force: true });
    } catch (e) { console.warn('[Mathroom 29.9.0 initial cleanup]', e); }
  }, 1000);

  setInterval(() => {
    if (document.getElementById('bankList')) refreshBadges().catch(() => {});
  }, 12000);
})();
