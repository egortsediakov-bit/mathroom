(() => {
  const MR = window.MR;
  if (!MR?.sb) return;
  const { sb, S, esc, toast, fail, modal, shuffle, CFG } = MR;

  let activeKey = '';
  let call = null;
  let refreshTimer = null;
  let observer = null;
  let addonBusy = false;

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ctxNow = () => {
    if (S.view === 'lesson' && S.activeLesson && S.user) {
      return { role: 'teacher', lessonId: S.activeLesson.id, lesson: S.activeLesson, studentId: S.activeLesson.student_id };
    }
    if (S.access && S.student && S.studentLive?.lesson_id) {
      return { role: 'student', lessonId: S.studentLive.lesson_id, studentId: S.student.id };
    }
    return null;
  };

  function signalTopic(lessonId) { return `lesson:${lessonId}:webrtc`; }

  class VideoSession {
    constructor(ctx) {
      this.ctx = ctx;
      this.role = ctx.role;
      this.lessonId = ctx.lessonId;
      this.channel = null;
      this.subscribed = false;
      this.localStream = null;
      this.remoteStream = new MediaStream();
      this.pc = null;
      this.pendingOffer = null;
      this.pendingIce = [];
      this.remoteReady = false;
      this.makingOffer = false;
      this.screenTrack = null;
      this.status = 'Видео выключено';
      this.destroyed = false;
      this.join();
    }

    iceServers() {
      const custom = CFG?.WEBRTC_ICE_SERVERS;
      if (Array.isArray(custom) && custom.length) return custom;
      return [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    async join() {
      this.channel = sb.channel(signalTopic(this.lessonId), { config: { private: true } })
        .on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload))
        .subscribe(status => {
          this.subscribed = status === 'SUBSCRIBED';
          if (this.subscribed) {
            this.send('hello', {});
            if (this.localStream) this.send(this.role === 'teacher' ? 'teacher-ready' : 'ready', {});
          }
          this.paintStatus();
        });
    }

    send(kind, data = {}, to = '') {
      if (!this.channel || !this.subscribed) return;
      this.channel.send({ type: 'broadcast', event: 'signal', payload: { kind, data, from: this.role, to, at: Date.now() } });
    }

    async onSignal(msg = {}) {
      if (this.destroyed || msg.from === this.role || (msg.to && msg.to !== this.role)) return;
      try {
        if (msg.kind === 'hello') {
          if (this.localStream) this.send(this.role === 'teacher' ? 'teacher-ready' : 'ready', {});
          return;
        }
        if (msg.kind === 'ready' || msg.kind === 'teacher-ready') {
          this.remoteReady = true;
          this.status = 'Собеседник готов';
          this.paintStatus();
          // The teacher is the offerer. When the teacher reconnects, the student
          // echoes readiness so a fresh offer can be created without reloading.
          if (this.role === 'student' && msg.kind === 'teacher-ready' && this.localStream) this.send('ready', {}, 'teacher');
          if (this.role === 'teacher' && this.localStream) await this.makeOffer();
          return;
        }
        if (msg.kind === 'offer' && this.role === 'student') {
          if (!this.localStream) {
            this.pendingOffer = msg.data;
            this.status = 'Преподаватель готов — включи камеру';
            this.paintStatus();
            return;
          }
          await this.acceptOffer(msg.data);
          return;
        }
        if (msg.kind === 'answer' && this.role === 'teacher') {
          const pc = this.ensurePeer();
          await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
          await this.flushIce();
          return;
        }
        if (msg.kind === 'ice') {
          const cand = msg.data ? new RTCIceCandidate(msg.data) : null;
          if (!cand) return;
          const pc = this.ensurePeer();
          if (pc.remoteDescription) await pc.addIceCandidate(cand);
          else this.pendingIce.push(cand);
          return;
        }
        if (msg.kind === 'hangup') {
          this.closePeer(false);
          this.status = 'Собеседник завершил видеосвязь';
          this.paintStatus();
        }
      } catch (e) {
        console.error('[Mathroom video] signal error', e);
        this.status = 'Ошибка соединения';
        this.paintStatus();
      }
    }

    attachLocalTracks(pc = this.pc) {
      if (!pc || !this.localStream) return;
      for (const track of this.localStream.getTracks()) {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
        if (!sender) pc.addTrack(track, this.localStream);
        else if (sender.track !== track && !(track.kind === 'video' && this.screenTrack)) sender.replaceTrack(track).catch(() => {});
      }
    }

    ensurePeer() {
      if (this.pc && this.pc.signalingState !== 'closed') {
        this.attachLocalTracks(this.pc);
        return this.pc;
      }
      const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
      this.pc = pc;
      this.pendingIce = [];
      this.attachLocalTracks(pc);
      pc.ontrack = e => {
        const tracks = e.streams?.[0]?.getTracks?.() || [e.track];
        for (const track of tracks) {
          if (!this.remoteStream.getTracks().some(t => t.id === track.id)) this.remoteStream.addTrack(track);
        }
        this.bindMedia();
      };
      pc.onicecandidate = e => { if (e.candidate) this.send('ice', e.candidate.toJSON()); };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        this.status = ({ connected: 'Соединено', connecting: 'Подключение…', disconnected: 'Связь прервана', failed: 'P2P не установлено — может понадобиться TURN', closed: 'Звонок завершён' })[state] || 'Подключение…';
        this.paintStatus();
        if (state === 'connected') this.bindMedia();
      };
      return pc;
    }

    async flushIce() {
      if (!this.pc?.remoteDescription) return;
      const items = this.pendingIce.splice(0);
      for (const c of items) await this.pc.addIceCandidate(c).catch(() => {});
    }

    async makeOffer() {
      if (this.role !== 'teacher' || !this.localStream || this.makingOffer) return;
      this.makingOffer = true;
      try {
        const pc = this.ensurePeer();
        if (pc.signalingState !== 'stable') return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send('offer', pc.localDescription.toJSON(), 'student');
        this.status = 'Ожидаем ученика…';
        this.paintStatus();
      } finally { this.makingOffer = false; }
    }

    async acceptOffer(data) {
      const pc = this.ensurePeer();
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send('answer', pc.localDescription.toJSON(), 'teacher');
      this.status = 'Подключение…';
      this.paintStatus();
    }

    async startMedia() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере');
        if (!window.isSecureContext) throw new Error('Для камеры нужен HTTPS');
        if (!this.localStream) {
          this.localStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
        }
        const pc = this.ensurePeer();
        this.attachLocalTracks(pc);
        this.bindMedia();
        this.status = 'Камера и микрофон включены';
        this.paintStatus();
        this.send(this.role === 'teacher' ? 'teacher-ready' : 'ready', {});
        if (this.role === 'student' && this.pendingOffer) {
          const offer = this.pendingOffer; this.pendingOffer = null; await this.acceptOffer(offer);
        }
        if (this.role === 'teacher' && this.remoteReady) await this.makeOffer();
      } catch (e) { fail(e); }
    }

    toggleMic() {
      const track = this.localStream?.getAudioTracks?.()[0];
      if (!track) return toast('Сначала включи камеру и микрофон');
      track.enabled = !track.enabled; this.renderButtons();
    }

    toggleCamera() {
      const track = this.localStream?.getVideoTracks?.()[0];
      if (!track) return toast('Сначала включи камеру');
      track.enabled = !track.enabled; this.renderButtons();
    }

    async shareScreen() {
      if (this.role !== 'teacher') return;
      try {
        if (!this.localStream) await this.startMedia();
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Демонстрация экрана недоступна в этом браузере');
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const track = stream.getVideoTracks()[0];
        const pc = this.ensurePeer();
        this.attachLocalTracks(pc);
        let sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(track); else sender = pc.addTrack(track, stream);
        this.screenTrack = track;
        const local = this.panel?.querySelector('#mrLocalVideo');
        if (local) { local.srcObject = stream; local.muted = true; local.play().catch(() => {}); }
        track.onended = async () => {
          const cam = this.localStream?.getVideoTracks?.()[0];
          if (sender) await sender.replaceTrack(cam || null).catch(() => {});
          this.screenTrack = null; this.bindMedia(); this.renderButtons();
        };
        this.renderButtons();
      } catch (e) { if (e?.name !== 'NotAllowedError') fail(e); }
    }

    closePeer(notify = true) {
      if (notify) this.send('hangup', {});
      try { this.pc?.close(); } catch {}
      this.pc = null; this.pendingIce = []; this.remoteStream = new MediaStream(); this.remoteReady = false;
      this.bindMedia();
    }

    end() {
      this.closePeer(true);
      this.localStream?.getTracks?.().forEach(t => t.stop());
      this.localStream = null;
      this.screenTrack?.stop?.(); this.screenTrack = null;
      this.status = 'Видео выключено'; this.bindMedia(); this.renderButtons(); this.paintStatus();
    }

    bindMedia() {
      const root = this.panel || document;
      const local = root.querySelector?.('#mrLocalVideo');
      const remote = root.querySelector?.('#mrRemoteVideo');
      if (local && !this.screenTrack) {
        if (local.srcObject !== (this.localStream || null)) local.srcObject = this.localStream || null;
        local.muted = true;
        if (this.localStream) local.play().catch(() => {});
      }
      if (remote) {
        if (remote.srcObject !== (this.remoteStream || null)) remote.srcObject = this.remoteStream || null;
        remote.muted = false;
        remote.volume = 1;
        if (this.remoteStream.getTracks().length) remote.play().catch(() => {});
      }
    }

    async enableSound() {
      const remote = this.panel?.querySelector('#mrRemoteVideo');
      if (!remote) return;
      try { remote.muted = false; remote.volume = 1; await remote.play(); toast('Звук включён'); }
      catch { toast('Браузер пока блокирует звук — нажми ещё раз после подключения'); }
    }

    paintStatus() {
      const el = this.panel?.querySelector('#mrVideoStatus') || document.querySelector('#mrVideoStatus');
      const text = this.status + (this.subscribed ? '' : ' · сигналинг…');
      if (el && el.textContent !== text) el.textContent = text;
    }

    renderButtons() {
      const root = this.panel || document;
      const mic = root.querySelector?.('#mrVideoMic'), cam = root.querySelector?.('#mrVideoCam'), screen = root.querySelector?.('#mrVideoScreen');
      const at = this.localStream?.getAudioTracks?.()[0], vt = this.localStream?.getVideoTracks?.()[0];
      const micText = at?.enabled === false ? '🔇 Микрофон выкл' : '🎙 Микрофон вкл';
      const camText = vt?.enabled === false ? '🚫 Камера выкл' : '📹 Камера вкл';
      const screenText = this.screenTrack ? '🖥 Экран включён' : '🖥 Экран';
      if (mic && mic.textContent !== micText) mic.textContent = micText;
      if (cam && cam.textContent !== camText) cam.textContent = camText;
      if (screen && screen.textContent !== screenText) screen.textContent = screenText;
    }

    renderPanel(target, compact = false) {
      if (!target) return;
      let host = target.querySelector(':scope > #mrVideoPanel');
      if (!host) {
        host = document.createElement('section'); host.id = 'mrVideoPanel';
        target.appendChild(host);
        host.innerHTML = `
          <div class="mr-video-head"><div><b>Видеоурок</b><div class="small muted" id="mrVideoStatus">${esc(this.status)}</div></div><span class="pill">P2P · WebRTC</span></div>
          <div class="mr-video-grid">
            <div class="mr-video-frame remote"><video id="mrRemoteVideo" autoplay playsinline></video><span>${this.role === 'teacher' ? 'Ученик' : 'Преподаватель'}</span></div>
            <div class="mr-video-frame local"><video id="mrLocalVideo" autoplay muted playsinline></video><span>Вы</span></div>
          </div>
          <div class="actions mr-video-actions">
            <button class="btn sm primary" id="mrVideoStart">Включить камеру</button>
            <button class="btn sm" id="mrVideoMic">🎙 Микрофон</button>
            <button class="btn sm" id="mrVideoCam">📹 Камера</button>
            <button class="btn sm" id="mrVideoSound">🔊 Звук</button>
            ${this.role === 'teacher' ? '<button class="btn sm" id="mrVideoScreen">🖥 Экран</button>' : ''}
            <button class="btn sm danger" id="mrVideoEnd">Отключиться</button>
          </div>
          <div class="small muted">Видео не записывается и не сохраняется Mathroom. Если удалённое видео не подключается, но локальная камера видна, сети может понадобиться TURN-сервер.</div>`;
        host.querySelector('#mrVideoStart').onclick = () => this.startMedia();
        host.querySelector('#mrVideoMic').onclick = () => this.toggleMic();
        host.querySelector('#mrVideoCam').onclick = () => this.toggleCamera();
        host.querySelector('#mrVideoSound').onclick = () => this.enableSound();
        const scr = host.querySelector('#mrVideoScreen'); if (scr) scr.onclick = () => this.shareScreen();
        host.querySelector('#mrVideoEnd').onclick = () => this.end();
      }
      this.panel = host;
      host.className = `mr-video-card ${compact ? 'compact' : ''}`;
      const start = host.querySelector('#mrVideoStart'); const startText = this.localStream ? 'Переподключить' : 'Включить камеру'; if (start && start.textContent !== startText) start.textContent = startText;
      this.bindMedia(); this.renderButtons(); this.paintStatus();
    }

    destroy() {
      this.destroyed = true; this.end();
      if (this.channel) sb.removeChannel(this.channel);
      this.channel = null;
    }
  }

  async function getQueue(lessonId) {
    const { data, error } = await sb.from('lesson_queue_items').select('*').eq('lesson_id', lessonId).order('position');
    if (error) throw error; return data || [];
  }

  function progressHtml(queue) {
    const c = { solved: 0, hard: 0, later: 0, pending: 0 };
    for (const q of queue) c[q.status] = (c[q.status] || 0) + 1;
    const done = queue.length ? queue.length - c.pending : 0;
    const pct = queue.length ? Math.round(done * 100 / queue.length) : 0;
    return `<div class="mr-progress"><div class="mr-progress-top"><b>Прогресс урока</b><span>${done}/${queue.length} · ${pct}%</span></div><div class="mr-progress-bar"><i style="width:${pct}%"></i></div><div class="mr-progress-stats"><span>✓ ${c.solved} решено</span><span>⚠ ${c.hard} сложно</span><span>↩ ${c.later} позже</span><span>○ ${c.pending} осталось</span></div></div>`;
  }

  async function saveCurrentTemplate(ctx) {
    try {
      const queue = await getQueue(ctx.lessonId);
      const ids = [...new Set(queue.map(x => x.exercise_id).filter(Boolean))];
      if (!ids.length) return toast('В очереди нет задач из банка');
      const name = prompt('Название шаблона урока:', `План · ${new Date().toLocaleDateString('ru-RU')}`);
      if (!name) return;
      const { error } = await sb.from('lesson_templates').insert({ teacher_id: S.user.id, name: name.trim(), topic_id: ctx.lesson?.topic_id || null, exercise_ids: ids });
      if (error) throw error; toast('Шаблон урока сохранён');
    } catch (e) { fail(e); }
  }

  async function applyExercisesToQueue(ctx, exerciseIds) {
    const queue = await getQueue(ctx.lessonId);
    const existing = new Set(queue.map(x => x.exercise_id).filter(Boolean));
    const exercises = (S.exercises || []).filter(x => exerciseIds.includes(x.id) && x.kind === 'task' && !existing.has(x.id));
    if (!exercises.length) return toast('Все задачи этого шаблона уже в очереди');
    const rows = exercises.map((x, i) => ({
      teacher_id: S.user.id, lesson_id: ctx.lessonId, exercise_id: x.id, title: x.title || 'Задача', prompt: x.content,
      correct_answer: x.answer || '', difficulty: x.difficulty || 'basic', category: x.category || '', tags: x.tags || [], position: queue.length + i
    }));
    const { error } = await sb.from('lesson_queue_items').insert(rows); if (error) throw error;
    toast(`Добавлено задач: ${rows.length}`);
    window.dispatchEvent(new Event('mathroom:refresh-lesson'));
  }

  async function openTemplates(ctx) {
    try {
      const { data, error } = await sb.from('lesson_templates').select('*').order('created_at', { ascending: false }); if (error) throw error;
      const list = data || [];
      const m = modal(`<h2>Шаблоны урока</h2><p class="muted">Сохраняй удачные очереди задач и используй их на следующих занятиях.</p><div class="list">${list.length ? list.map(t => `<div class="row"><div><b>${esc(t.name)}</b><div class="small muted">${(t.exercise_ids || []).length} задач</div></div><div class="actions"><button class="btn sm primary" data-apply-template="${t.id}">Добавить</button><button class="btn sm danger" data-delete-template="${t.id}">Удалить</button></div></div>`).join('') : '<div class="empty">Шаблонов пока нет.</div>'}</div>`, 'wide-modal');
      m.querySelectorAll('[data-apply-template]').forEach(b => b.onclick = async () => {
        const t = list.find(x => x.id === b.dataset.applyTemplate); if (!t) return;
        try { await applyExercisesToQueue(ctx, t.exercise_ids || []); m.remove(); } catch (e) { fail(e); }
      });
      m.querySelectorAll('[data-delete-template]').forEach(b => b.onclick = async () => {
        if (!confirm('Удалить шаблон?')) return;
        const { error: er } = await sb.from('lesson_templates').delete().eq('id', b.dataset.deleteTemplate); if (er) return fail(er);
        b.closest('.row')?.remove(); toast('Шаблон удалён');
      });
    } catch (e) { fail(e); }
  }

  async function quickPlan(ctx) {
    try {
      const topicId = ctx.lesson?.topic_id;
      const tasks = (S.exercises || []).filter(x => x.topic_id === topicId && x.kind === 'task');
      if (!tasks.length) return toast('В теме пока нет задач');
      const pick = (d, n) => shuffle(tasks.filter(x => x.difficulty === d)).slice(0, n);
      const chosen = [...pick('basic', 2), ...pick('medium', 3), ...pick('advanced', 1)];
      const ids = [...new Set((chosen.length ? chosen : shuffle(tasks).slice(0, 6)).map(x => x.id))];
      await applyExercisesToQueue(ctx, ids);
    } catch (e) { fail(e); }
  }

  async function refreshTeacherAddon(ctx) {
    if (addonBusy) return; addonBusy = true;
    try {
      const control = document.querySelector('#lessonControl'); if (!control) return;
      let host = document.querySelector('#mrLessonAddon');
      const queue = await getQueue(ctx.lessonId);
      if (!host) {
        host = document.createElement('div'); host.id = 'mrLessonAddon'; host.className = 'mr-lesson-addon'; control.insertAdjacentElement('afterend', host);
        host.innerHTML = `<div class="mr-addon-toolbar"><div id="mrProgressMount"></div><div class="actions"><button class="btn sm" id="mrQuickPlan">⚡ Быстрый план</button><button class="btn sm" id="mrSaveTemplate">Сохранить план</button><button class="btn sm" id="mrOpenTemplates">Шаблоны</button></div></div><div id="mrTeacherVideoMount"></div>`;
        host.querySelector('#mrQuickPlan').onclick = () => quickPlan(ctx);
        host.querySelector('#mrSaveTemplate').onclick = () => saveCurrentTemplate(ctx);
        host.querySelector('#mrOpenTemplates').onclick = () => openTemplates(ctx);
      }
      const progress = host.querySelector('#mrProgressMount'); const progressMarkup = progressHtml(queue); if (progress && progress.innerHTML !== progressMarkup) progress.innerHTML = progressMarkup;
      call?.renderPanel(host.querySelector('#mrTeacherVideoMount'), false);
    } catch (e) { console.error(e); } finally { addonBusy = false; }
  }

  function refreshStudentAddon() {
    const home = document.querySelector('.student-home'); if (!home || !call) return;
    let mount = document.querySelector('#mrStudentVideoMount');
    if (!mount) {
      mount = document.createElement('div'); mount.id = 'mrStudentVideoMount';
      const live = home.querySelector('.student-live-mount');
      if (live) live.insertAdjacentElement('afterend', mount); else home.prepend(mount);
    }
    call.renderPanel(mount, home.classList.contains('student-focus'));
  }

  async function syncContext() {
    const ctx = ctxNow();
    const key = ctx ? `${ctx.role}:${ctx.lessonId}` : '';
    if (key !== activeKey) {
      if (call) call.destroy(); call = null; activeKey = key;
      clearInterval(refreshTimer); refreshTimer = null;
      if (ctx) {
        call = new VideoSession(ctx);
        refreshTimer = setInterval(() => {
          const c = ctxNow(); if (!c || `${c.role}:${c.lessonId}` !== activeKey) return;
          if (c.role === 'teacher') refreshTeacherAddon(c); else refreshStudentAddon();
        }, 2500);
      }
    }
    if (!ctx) return;
    if (ctx.role === 'teacher') await refreshTeacherAddon(ctx); else refreshStudentAddon();
  }

  let scheduled = false;
  function scheduleSync() {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(async () => { scheduled = false; await syncContext(); });
  }

  observer = new MutationObserver(scheduleSync);
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => { call?.destroy(); clearInterval(refreshTimer); observer?.disconnect(); });
  scheduleSync();
})();
