(() => {
  const MR = window.MR;
  if (!MR?.sb) return;
  const { sb, S, esc, nl, toast, fail, modal, shuffle, CFG, copyText, uid, dateLong, statusLabel } = MR;

  let activeKey = '';
  let call = null;
  let refreshTimer = null;
  let observer = null;
  let addonBusy = false;
  let noteSaveTimer = null;
  let noteLessonId = '';
  let historyBaseline = new Map();
  let historyBusy = false;

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
      this.peerId = crypto.randomUUID ? crypto.randomUUID() : `peer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.localStream = null;
      this.remoteStream = new MediaStream();
      this.pc = null;
      this.panel = null;
      this.prejoin = null;
      this.fastChannel = null;
      this.fastSubscribed = false;
      this.destroyed = false;
      this.joined = false;
      this.remoteReady = false;
      this.makingOffer = false;
      this.pendingOffer = null;
      this.pendingIce = [];
      this.currentOfferId = '';
      this.remoteOfferId = '';
      this.seenMessages = new Set();
      this.signalSeq = 0;
      this.pollTimer = null;
      this.readyTimer = null;
      this.connectTimer = null;
      this.disconnectTimer = null;
      this.statsTimer = null;
      this.reconnectAttempts = 0;
      this.status = 'Готов к подключению';
      this.connectionQuality = '';
      this.screenTrack = null;
      this.screenPreviewStream = null;
      this.soundEnabled = localStorage.getItem(`mathroom.media.sound.${this.role}`) !== '0';
      this.expanded = localStorage.getItem(`mathroom.media.expanded.${this.role}`) === '1';
      this.micEnabled = localStorage.getItem(`mathroom.media.mic.${this.role}`) !== '0';
      this.cameraEnabled = localStorage.getItem(`mathroom.media.camera.${this.role}`) !== '0';
      this.minimized = localStorage.getItem(`mathroom.media.minimized.${this.role}`) === '1';
      this.videoViewMode = localStorage.getItem(`mathroom.media.view.${this.role}`) || 'both';
      if (!['remote','both','hidden'].includes(this.videoViewMode)) this.videoViewMode = 'both';
      this.videoFloating = false;
      this.videoHeroMount = null;
      this.videoHeroHeight = 0;
      this.onVideoScroll = null;
      this.selectedAudioInput = localStorage.getItem(`mathroom.media.audioinput.${this.role}`) || '';
      this.selectedVideoInput = localStorage.getItem(`mathroom.media.videoinput.${this.role}`) || '';
      this.selectedAudioOutput = localStorage.getItem(`mathroom.media.audiooutput.${this.role}`) || '';
      this.devices = { audioinput:[], videoinput:[], audiooutput:[] };
      this.deviceModal = null;
      this.deviceRefreshTimer = null;
      this.outputSelectionSupported = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype?.setSinkId === 'function';
      this.onDeviceChange = () => {
        clearTimeout(this.deviceRefreshTimer);
        this.deviceRefreshTimer = setTimeout(() => this.handleDeviceChange().catch(e => console.warn('[Mathroom devices]', e)), 220);
      };
      navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
      this.baseIceServers = Array.isArray(CFG?.WEBRTC_ICE_SERVERS) && CFG.WEBRTC_ICE_SERVERS.length
        ? CFG.WEBRTC_ICE_SERVERS
        : [
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' }
          ];
      this.iceServers = [...this.baseIceServers];
      this.turnLoadedAt = 0;
      this.turnExpiresAt = 0;
      this.hasTurn = this.iceServers.some(x => String(Array.isArray(x.urls) ? x.urls.join(' ') : x.urls || '').includes('turn:'));
      this.staticTurnConfigured = this.hasTurn;
      this.forceRelay = false;
      this.relayEscalated = false;
      this.routeLabel = '';
      this.ensureStyles();
      this.startSignaling();
      this.onOnline = () => {
        if (this.destroyed || !this.joined) return;
        this.status = 'Интернет вернулся · восстанавливаем связь…';
        this.paint();
        if (this.role === 'teacher') this.reconnect(true).catch(() => {});
        else this.send('need-offer', { joined: true }, 'teacher').catch(() => {});
      };
      window.addEventListener('online', this.onOnline);
    }

    ensureStyles() {
      if (document.getElementById('mrNativeMediaStyles')) return;
      const st = document.createElement('style');
      st.id = 'mrNativeMediaStyles';
      st.textContent = `
        .mr-native-call{border:1px solid var(--line,#e5e7eb);background:#fff;border-radius:18px;padding:14px;display:grid;gap:10px;box-shadow:0 8px 26px rgba(20,24,32,.05)}
        .mr-native-call .mr-call-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.mr-native-call .mr-call-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mr-native-call .mr-call-dot{width:9px;height:9px;border-radius:50%;background:#aeb4bd;box-shadow:0 0 0 4px rgba(120,125,135,.1)}.mr-native-call.connected .mr-call-dot{background:#25a464;box-shadow:0 0 0 4px rgba(37,164,100,.12)}
        .mr-native-call .mr-call-stage{display:none;position:relative;background:#101214;border-radius:14px;overflow:hidden;aspect-ratio:16/9;min-height:170px}.mr-native-call.joined .mr-call-stage{display:block}.mr-native-call .mr-remote-video{width:100%;height:100%;object-fit:contain;display:block;background:#101214}.mr-native-call .mr-local-video{position:absolute;right:10px;top:10px;width:104px;height:70px;object-fit:cover;border:2px solid rgba(255,255,255,.88);border-radius:10px;background:#1b1d20;box-shadow:0 6px 18px #0005;cursor:zoom-in}.mr-native-call.sharing .mr-local-video{object-fit:contain;background:#0b0d10}.mr-native-call .mr-call-person{position:absolute;left:10px;bottom:10px;background:#0009;color:#fff;padding:4px 8px;border-radius:8px;font-size:11px}.mr-native-call .mr-call-actions{display:flex;gap:7px;flex-wrap:wrap}.mr-native-call .mr-call-actions .btn{min-height:38px}.mr-native-call .mr-call-note{font-size:12px;color:var(--muted,#747b85);line-height:1.45}.mr-native-call .mr-call-quality{font-size:11px;color:var(--muted,#747b85)}
        .mr-native-call.joined{position:fixed;right:18px;bottom:18px;z-index:1250;width:320px;max-width:calc(100vw - 36px);padding:10px;box-shadow:0 18px 55px #0004;transition:width .18s ease,height .18s ease}.mr-native-call.joined .mr-call-head{cursor:move}.mr-native-call.joined.expanded{width:min(860px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto}.mr-native-call.joined.expanded .mr-call-stage{min-height:360px;aspect-ratio:16/9}.mr-native-call.joined.expanded .mr-local-video{width:180px;height:110px}.mr-native-call.joined.minimized{width:260px}.mr-native-call.joined.minimized .mr-call-stage,.mr-native-call.joined.minimized .mr-call-note,.mr-native-call.joined.minimized .mr-call-quality{display:none}.mr-native-call.joined.minimized .mr-call-actions .mr-hide-min{display:none}
        .mr-native-prejoin-backdrop{position:fixed;inset:0;z-index:3000;background:rgba(8,11,16,.72);display:flex;align-items:center;justify-content:center;padding:18px}.mr-native-prejoin{width:min(720px,100%);background:#fff;border-radius:22px;padding:18px;box-shadow:0 28px 90px #0007;display:grid;gap:14px}.mr-native-prejoin h2{margin:0}.mr-native-prejoin-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px}.mr-native-preview{position:relative;background:#111318;border-radius:16px;overflow:hidden;aspect-ratio:16/10}.mr-native-preview video{width:100%;height:100%;display:block;object-fit:cover}.mr-native-preview .mr-preview-name{position:absolute;left:10px;bottom:10px;background:#0009;color:#fff;padding:5px 8px;border-radius:8px;font-size:12px}.mr-native-prejoin-side{display:grid;align-content:start;gap:9px}.mr-native-prejoin-side .btn{min-height:44px}.mr-native-prejoin-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.mr-native-prejoin-error{display:none;padding:10px 12px;background:#fff4f2;color:#9a291d;border:1px solid #f0d3ce;border-radius:12px;font-size:13px}.mr-native-prejoin-error.show{display:block}
        .mr-media-device-fields{display:grid;gap:9px;margin-top:2px}.mr-media-device-field{display:grid;gap:4px}.mr-media-device-field label{font-size:11px;font-weight:750;color:var(--muted,#747b85)}.mr-media-device-field select{width:100%;min-height:38px;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:#fff;padding:7px 9px;color:inherit}.mr-media-device-field select:disabled{opacity:.55;background:#f6f6f5}.mr-device-count{font-size:11px;color:var(--muted,#747b85);line-height:1.4}.mr-device-modal-grid{display:grid;grid-template-columns:1fr;gap:12px;margin:14px 0}.mr-native-call .mr-device-btn{white-space:nowrap}
        @media(max-width:760px){.mr-native-prejoin{padding:14px}.mr-native-prejoin-grid{grid-template-columns:1fr}.mr-native-prejoin-side{grid-template-columns:1fr 1fr}.mr-native-prejoin-side .mr-prejoin-wide{grid-column:1/-1}.mr-native-prejoin-footer{display:grid;grid-template-columns:1fr;width:100%}.mr-native-prejoin-footer .btn{width:100%;min-height:50px}.mr-native-call.joined{position:relative;right:auto;bottom:auto;width:100%;max-width:none;box-shadow:none}.mr-native-call.joined.expanded{position:fixed;inset:8px;width:auto;max-width:none;max-height:none;z-index:3200;overflow:auto}.mr-native-call.joined.expanded .mr-call-stage{min-height:50vh}.mr-native-call.joined .mr-call-head{cursor:default}.mr-native-call .mr-call-stage{min-height:210px}.mr-native-call .mr-local-video{width:88px;height:62px}.mr-native-call.joined.expanded .mr-local-video{width:120px;height:80px}}
      `;
      document.head.appendChild(st);
    }

    async roomTopic() {
      const token = this.role === 'student'
        ? String(S.access || '')
        : String((S.students || []).find(x => x.id === this.ctx.studentId)?.access_token || '');
      const raw = `${this.lessonId}:${token || this.ctx.studentId || ''}:media-v25`;
      try {
        if (crypto?.subtle) {
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
          return `media:${[...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('').slice(0,40)}`;
        }
      } catch {}
      let h = 2166136261;
      for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
      return `media:${(h >>> 0).toString(16)}:${this.lessonId.slice(0,8)}`;
    }

    async startSignaling() {
      try {
        const topic = await this.roomTopic();
        if (this.destroyed) return;
        this.fastChannel = sb.channel(topic, { config: { broadcast: { self: false, ack: false } } })
          .on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload))
          .subscribe(status => {
            this.fastSubscribed = status === 'SUBSCRIBED';
            this.paint();
            if (this.fastSubscribed) this.send('hello', { online: true }, this.otherRole()).catch(() => {});
          });
      } catch (e) { console.warn('[Mathroom media] realtime unavailable', e); }
      this.schedulePoll(150);
    }

    otherRole() { return this.role === 'teacher' ? 'student' : 'teacher'; }

    async ensureIceServers(force = false) {
      const now = Date.now();
      if (!force && this.staticTurnConfigured) return this.iceServers;
      if (!force && this.hasTurn && this.turnExpiresAt > now + 5 * 60 * 1000) return this.iceServers;
      try {
        const body = {
          lesson_id: this.lessonId,
          role: this.role,
          access_token: this.role === 'student' ? String(S.access || '') : ''
        };
        const { data, error } = await sb.functions.invoke('turn-credentials', { body });
        if (error) throw error;
        const turn = data?.iceServer || (Array.isArray(data?.iceServers) ? data.iceServers[0] : null);
        if (!turn?.urls || !turn?.username || !turn?.credential) throw new Error('TURN credentials are incomplete');
        this.iceServers = [...this.baseIceServers, turn];
        this.hasTurn = true;
        this.turnLoadedAt = now;
        this.turnExpiresAt = Number(data?.expiresAt || 0) || (now + Math.max(30, Number(data?.ttl || 7200)) * 1000);
        this.paint();
        return this.iceServers;
      } catch (e) {
        console.warn('[Mathroom media] TURN credentials unavailable; using direct P2P only', e);
        this.iceServers = [...this.baseIceServers];
        this.hasTurn = this.iceServers.some(x => String(Array.isArray(x.urls) ? x.urls.join(' ') : x.urls || '').includes('turn:'));
        this.turnLoadedAt = now;
        this.turnExpiresAt = 0;
        this.paint();
        return this.iceServers;
      }
    }

    schedulePoll(delay = 800) {
      clearTimeout(this.pollTimer);
      if (this.destroyed || this.pc?.connectionState === 'connected') return;
      this.pollTimer = setTimeout(() => this.pollSignals().finally(() => this.schedulePoll(850)), delay);
    }

    async pollSignals() {
      try {
        const since = new Date(Date.now() - 30000).toISOString();
        let data, error;
        if (this.role === 'student') {
          ({ data, error } = await sb.rpc('webrtc_student_get_signals', {
            p_lesson_id: this.lessonId,
            p_access_token: String(S.access || ''),
            p_since: since
          }));
        } else {
          ({ data, error } = await sb.rpc('webrtc_get_signals', {
            p_lesson_id: this.lessonId,
            p_after_id: 0,
            p_for_role: 'teacher',
            p_since: since
          }));
        }
        if (error) throw error;
        for (const row of (data || [])) {
          if (row.peer_id === this.peerId || row.sender_role === this.role) continue;
          await this.onSignal({
            kind: row.kind,
            data: row.payload || {},
            from: row.sender_role,
            to: row.recipient_role || '',
            peerId: row.peer_id,
            msgId: row.payload?.__mid || `db:${row.id}`
          });
        }
      } catch (e) {
        if (!this.fastSubscribed) console.warn('[Mathroom media] DB signaling unavailable', e);
      }
    }

    async send(kind, data = {}, to = '') {
      if (this.destroyed) return false;
      const mid = data.__mid || `${this.peerId}:${Date.now()}:${++this.signalSeq}`;
      const body = { ...data, __mid: mid };
      const payload = { kind, data: body, from: this.role, to, peerId: this.peerId, msgId: mid, at: Date.now() };
      const jobs = [];
      if (this.fastChannel && this.fastSubscribed) jobs.push(this.fastChannel.send({ type:'broadcast', event:'signal', payload }));
      if (this.role === 'student') {
        jobs.push(sb.rpc('webrtc_student_send_signal', {
          p_lesson_id: this.lessonId,
          p_access_token: String(S.access || ''),
          p_to: to || 'teacher',
          p_kind: kind,
          p_payload: body,
          p_peer_id: this.peerId
        }));
      } else {
        jobs.push(sb.rpc('webrtc_send_signal', {
          p_lesson_id: this.lessonId,
          p_from: 'teacher',
          p_to: to || 'student',
          p_kind: kind,
          p_payload: body,
          p_peer_id: this.peerId
        }));
      }
      const settled = await Promise.allSettled(jobs);
      return settled.some(x => x.status === 'fulfilled' && !x.value?.error);
    }

    async onSignal(msg) {
      if (!msg || this.destroyed) return;
      if (msg.peerId === this.peerId || msg.from === this.role) return;
      if (msg.to && msg.to !== this.role) return;
      const mid = msg.msgId || msg.data?.__mid;
      if (mid) {
        if (this.seenMessages.has(mid)) return;
        this.seenMessages.add(mid);
        if (this.seenMessages.size > 500) this.seenMessages = new Set([...this.seenMessages].slice(-250));
      }
      const kind = msg.kind;
      const data = msg.data || {};
      if (kind === 'hello') {
        this.remoteReady = true;
        if (this.joined) await this.send(this.role === 'teacher' ? 'teacher-ready' : 'ready', { joined:true }, this.otherRole());
        if (this.role === 'teacher' && this.joined && !this.isConnected()) this.makeOffer(false).catch(() => {});
        return;
      }
      if (kind === 'teacher-ready' || kind === 'ready' || kind === 'need-offer') {
        this.remoteReady = true;
        if (kind === 'need-offer' && data?.relay && this.role === 'teacher' && this.hasTurn) this.forceRelay = true;
        if (this.role === 'teacher' && this.joined && !this.isConnected()) this.makeOffer(!!data?.reconnect).catch(() => {});
        return;
      }
      if (kind === 'offer' && this.role === 'student') {
        if (!this.joined) { this.pendingOffer = data; return; }
        await this.acceptOffer(data);
        return;
      }
      if (kind === 'answer' && this.role === 'teacher') {
        await this.acceptAnswer(data);
        return;
      }
      if (kind === 'ice') {
        await this.acceptIce(data);
        return;
      }
      if (kind === 'hangup') {
        this.remoteReady = false;
        this.closePeer(false);
        this.status = 'Собеседник вышел из звонка';
        this.paint();
        if (this.joined) this.startReadyLoop();
      }
    }

    isConnected() { return this.pc?.connectionState === 'connected'; }

    createPeer() {
      if (this.pc && this.pc.signalingState !== 'closed') return this.pc;
      const pc = new RTCPeerConnection({
        iceServers: this.iceServers,
        iceCandidatePoolSize: 2,
        bundlePolicy: 'max-bundle',
        iceTransportPolicy: this.forceRelay && this.hasTurn ? 'relay' : 'all'
      });
      this.pc = pc;
      this.pendingIce = [];
      this.remoteStream = new MediaStream();
      pc.ontrack = e => {
        const incoming = e.streams?.[0]?.getTracks?.() || [e.track];
        for (const track of incoming) if (track && !this.remoteStream.getTracks().some(t => t.id === track.id)) this.remoteStream.addTrack(track);
        this.bindMedia();
      };
      pc.onicecandidate = e => {
        if (!e.candidate) return;
        const offerId = this.role === 'teacher' ? this.currentOfferId : this.remoteOfferId;
        this.send('ice', { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate, offerId }, this.otherRole()).catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) return;
        const st = pc.connectionState;
        if (st === 'connected') {
          this.status = 'Соединено';
          this.reconnectAttempts = 0;
          this.relayEscalated = this.forceRelay;
          clearTimeout(this.connectTimer);
          clearTimeout(this.disconnectTimer);
          clearInterval(this.readyTimer);
          this.readyTimer = null;
          clearTimeout(this.pollTimer);
          this.pollTimer = null;
          this.bindMedia();
          this.startStats();
        } else if (st === 'connecting' || st === 'new') {
          this.status = 'Подключаемся…';
        } else if (st === 'disconnected') {
          this.status = 'Связь прервана · восстанавливаем…';
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => {
            if (this.destroyed || !this.joined || this.isConnected()) return;
            if (this.role === 'teacher') this.reconnect(true).catch(() => {});
            else this.send('need-offer', { joined:true, reconnect:true }, 'teacher').catch(() => {});
          }, 2500);
        } else if (st === 'failed') {
          if (this.hasTurn && !this.forceRelay) {
            this.status = 'Прямое соединение недоступно · включаем резервный канал…';
            if (this.role === 'teacher' && this.joined) setTimeout(() => this.reconnect(true, true).catch(() => {}), 500);
            else if (this.role === 'student' && this.joined) this.send('need-offer', { joined:true, reconnect:true, relay:true }, 'teacher').catch(() => {});
          } else {
            this.status = this.hasTurn ? 'Не удалось соединиться · повторяем…' : 'Прямая связь не установилась · пробуем ещё раз…';
            if (this.role === 'teacher' && this.joined && this.reconnectAttempts < 2) setTimeout(() => this.reconnect(true, this.forceRelay).catch(() => {}), 900);
            else if (this.role === 'student' && this.joined) this.send('need-offer', { joined:true, reconnect:true, relay:this.forceRelay }, 'teacher').catch(() => {});
          }
        }
        this.paint();
      };
      pc.oniceconnectionstatechange = () => this.paint();
      return pc;
    }

    bindOffererTracks(pc) {
      if (!this.localStream) return;
      const currentKinds = new Set(pc.getSenders().map(s => s.track?.kind).filter(Boolean));
      const tracks = [];
      const audio = this.localStream.getAudioTracks()[0]; if (audio) tracks.push(audio);
      const video = this.screenTrack || this.localStream.getVideoTracks()[0]; if (video) tracks.push(video);
      for (const track of tracks) {
        if (!currentKinds.has(track.kind)) pc.addTrack(track, track === this.screenTrack ? new MediaStream([track]) : this.localStream);
      }
    }

    async bindAnswererTracks(pc) {
      if (!this.localStream) return;
      for (const kind of ['audio','video']) {
        const track = kind === 'video' && this.screenTrack
          ? this.screenTrack
          : this.localStream.getTracks().find(t => t.kind === kind);
        if (!track) continue;
        let tr = pc.getTransceivers().find(t => t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind);
        if (!tr) tr = pc.addTransceiver(kind, { direction:'sendrecv' });
        try { await tr.sender.replaceTrack(track); } catch (e) { console.warn('[Mathroom media] replaceTrack', kind, e); }
        try { tr.direction = 'sendrecv'; } catch {}
      }
    }

    async makeOffer(iceRestart = false) {
      if (this.destroyed || !this.joined || this.role !== 'teacher' || this.makingOffer) return;
      const pc = this.createPeer();
      if (pc.signalingState !== 'stable') return;
      this.makingOffer = true;
      try {
        this.bindOffererTracks(pc);
        this.currentOfferId = crypto.randomUUID ? crypto.randomUUID() : `offer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const offer = await pc.createOffer({ iceRestart: !!iceRestart });
        await pc.setLocalDescription(offer);
        this.status = this.remoteReady ? 'Соединяем…' : 'Ждём собеседника…';
        this.paint();
        await this.send('offer', { type:pc.localDescription.type, sdp:pc.localDescription.sdp, offerId:this.currentOfferId }, 'student');
        clearTimeout(this.connectTimer);
        this.connectTimer = setTimeout(() => {
          if (this.destroyed || !this.joined || this.isConnected()) return;
          if (this.hasTurn && !this.forceRelay) {
            this.status = 'Прямой маршрут не ответил · переключаемся на резервный сервер…';
            this.paint();
            this.reconnect(true, true).catch(() => {});
          } else if (this.reconnectAttempts < 2) this.reconnect(true, this.forceRelay).catch(() => {});
          else {
            this.status = this.hasTurn
              ? 'Не удалось подключиться. Проверь интернет и нажми «Переподключить».'
              : 'Резервный сервер связи недоступен. Проверь интернет и нажми «Переподключить».';
            this.paint();
          }
        }, this.hasTurn && !this.forceRelay ? 6000 : 9000);
      } finally { this.makingOffer = false; }
    }

    async acceptOffer(data) {
      const offerId = data?.offerId || '';
      if (!data?.sdp) return;
      if (this.remoteOfferId && offerId && this.remoteOfferId === offerId && this.pc?.remoteDescription?.type === 'offer') return;
      if (this.pc && this.pc.signalingState !== 'stable') this.closePeer(false);
      const pc = this.createPeer();
      this.remoteOfferId = offerId;
      this.status = 'Принимаем соединение…';
      this.paint();
      await pc.setRemoteDescription(new RTCSessionDescription({ type:data.type || 'offer', sdp:data.sdp }));
      await this.bindAnswererTracks(pc);
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.send('answer', { type:pc.localDescription.type, sdp:pc.localDescription.sdp, offerId:this.remoteOfferId }, 'teacher');
      this.status = 'Ответ отправлен · подключаемся…';
      this.paint();
    }

    async acceptAnswer(data) {
      if (!this.pc || !data?.sdp) return;
      if (data.offerId && this.currentOfferId && data.offerId !== this.currentOfferId) return;
      if (this.pc.signalingState !== 'have-local-offer') return;
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type:data.type || 'answer', sdp:data.sdp }));
      await this.flushIce();
      this.status = 'Проверяем соединение…';
      this.paint();
    }

    async acceptIce(data) {
      const c = data?.candidate;
      if (!c) return;
      const offerId = data?.offerId || '';
      if (this.role === 'teacher' && offerId && this.currentOfferId && offerId !== this.currentOfferId) return;
      if (this.role === 'student' && offerId && this.remoteOfferId && offerId !== this.remoteOfferId) return;
      if (!this.pc || !this.pc.remoteDescription?.type) {
        this.pendingIce.push({ candidate:c, offerId });
        return;
      }
      try { await this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('[Mathroom media] ICE', e); }
    }

    async flushIce() {
      if (!this.pc?.remoteDescription?.type || !this.pendingIce.length) return;
      const rows = this.pendingIce.splice(0);
      for (const row of rows) await this.acceptIce(row);
    }

    audioConstraints(deviceId = this.selectedAudioInput) {
      const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
      const audio = {};
      if (deviceId) audio.deviceId = { exact:deviceId };
      if (supported.echoCancellation !== false) audio.echoCancellation = { ideal:true };
      if (supported.noiseSuppression !== false) audio.noiseSuppression = { ideal:true };
      if (supported.autoGainControl !== false) audio.autoGainControl = { ideal:true };
      if (supported.channelCount) audio.channelCount = { ideal:1 };
      if (supported.sampleRate) audio.sampleRate = { ideal:48000 };
      if (supported.sampleSize) audio.sampleSize = { ideal:16 };
      if (supported.latency) audio.latency = { ideal:0.02 };
      if (supported.voiceIsolation) audio.voiceIsolation = { ideal:true };
      return audio;
    }

    videoConstraints(deviceId = this.selectedVideoInput) {
      const video = { width:{ideal:960}, height:{ideal:540}, frameRate:{ideal:24,max:30} };
      if (deviceId) video.deviceId = { exact:deviceId };
      return video;
    }

    async configureSpeechTrack(track) {
      if (!track) return;
      try { track.contentHint = 'speech'; } catch {}
      try {
        const apply = {};
        const caps = track.getCapabilities?.() || {};
        if ('echoCancellation' in caps) apply.echoCancellation = true;
        if ('noiseSuppression' in caps) apply.noiseSuppression = true;
        if ('autoGainControl' in caps) apply.autoGainControl = true;
        if ('channelCount' in caps) apply.channelCount = 1;
        if (Object.keys(apply).length) await track.applyConstraints(apply);
      } catch (e) {
        console.warn('[Mathroom audio] speech constraints were partially unavailable', e);
      }
    }

    currentInputDeviceId(kind) {
      const track = kind === 'audioinput'
        ? this.localStream?.getAudioTracks?.()[0]
        : this.localStream?.getVideoTracks?.()[0];
      return track?.getSettings?.().deviceId || '';
    }

    async refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return this.devices;
      const list = await navigator.mediaDevices.enumerateDevices();
      this.devices = {
        audioinput:list.filter(x => x.kind === 'audioinput'),
        videoinput:list.filter(x => x.kind === 'videoinput'),
        audiooutput:list.filter(x => x.kind === 'audiooutput')
      };
      this.refreshDeviceUi();
      return this.devices;
    }

    deviceOptionLabel(device, kind, index) {
      if (device?.label) return device.label;
      if (kind === 'audioinput') return `Микрофон ${index + 1}`;
      if (kind === 'videoinput') return `Камера ${index + 1}`;
      return `Динамики ${index + 1}`;
    }

    populateDeviceSelect(select, kind) {
      if (!select) return;
      const devices = this.devices[kind] || [];
      const preferred = kind === 'audioinput'
        ? (this.selectedAudioInput || this.currentInputDeviceId(kind))
        : kind === 'videoinput'
          ? (this.selectedVideoInput || this.currentInputDeviceId(kind))
          : this.selectedAudioOutput;
      const firstLabel = kind === 'audiooutput' ? 'Системный вывод звука' : (kind === 'audioinput' ? 'Системный микрофон' : 'Системная камера');
      select.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = firstLabel;
      select.appendChild(def);
      devices.forEach((device,index) => {
        const o=document.createElement('option');
        o.value=device.deviceId || '';
        o.textContent=this.deviceOptionLabel(device,kind,index);
        select.appendChild(o);
      });
      if (preferred && [...select.options].some(o => o.value === preferred)) select.value = preferred;
      else select.value = '';
      if (kind === 'audiooutput' && !this.outputSelectionSupported) {
        select.disabled = true;
        select.title = 'Выбор динамиков не поддерживается этим браузером — используется системное устройство';
      } else select.disabled = false;
    }

    refreshDeviceUi() {
      const roots = [this.prejoin, this.deviceModal].filter(x => x && document.body.contains(x));
      for (const root of roots) {
        this.populateDeviceSelect(root.querySelector('[data-device-kind="audioinput"]'),'audioinput');
        this.populateDeviceSelect(root.querySelector('[data-device-kind="videoinput"]'),'videoinput');
        this.populateDeviceSelect(root.querySelector('[data-device-kind="audiooutput"]'),'audiooutput');
        const count=root.querySelector('.mr-device-count');
        if (count) count.textContent = `${this.devices.audioinput.length} микроф. · ${this.devices.videoinput.length} камер · ${this.devices.audiooutput.length} выходов${this.outputSelectionSupported ? '' : ' · выбор выхода управляется браузером/системой'}`;
      }
    }

    bindDeviceSelects(root) {
      if (!root) return;
      const mic=root.querySelector('[data-device-kind="audioinput"]');
      const cam=root.querySelector('[data-device-kind="videoinput"]');
      const out=root.querySelector('[data-device-kind="audiooutput"]');
      if (mic) mic.onchange = () => this.switchInputDevice('audio',mic.value).catch(fail);
      if (cam) cam.onchange = () => this.switchInputDevice('video',cam.value).catch(fail);
      if (out) out.onchange = () => this.setAudioOutput(out.value).catch(fail);
    }

    async setAudioOutput(deviceId = '', silent = false) {
      this.selectedAudioOutput = deviceId || '';
      localStorage.setItem(`mathroom.media.audiooutput.${this.role}`, this.selectedAudioOutput);
      const audio=this.panel?.querySelector('#mrRemoteAudio');
      if (!this.outputSelectionSupported || !audio?.setSinkId) {
        this.refreshDeviceUi();
        if (!silent) toast('Выбор вывода звука в этом браузере управляется системой');
        return false;
      }
      try {
        await audio.setSinkId(this.selectedAudioOutput);
        audio.dataset.sinkId = this.selectedAudioOutput;
        this.refreshDeviceUi();
        if (!silent) toast('Устройство вывода звука изменено');
        return true;
      } catch (e) {
        if (!silent) throw e;
        return false;
      }
    }

    async switchInputDevice(kind, deviceId = '', opts = {}) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Браузер не поддерживает выбор устройств');
      const isAudio = kind === 'audio';
      const constraints = isAudio
        ? { audio:this.audioConstraints(deviceId), video:false }
        : { audio:false, video:this.videoConstraints(deviceId) };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const next = isAudio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!next) throw new Error(isAudio ? 'Микрофон не найден' : 'Камера не найдена');
      if (isAudio) {
        next.enabled = this.micEnabled;
        await this.configureSpeechTrack(next);
      } else next.enabled = this.cameraEnabled;

      if (!this.localStream) this.localStream = new MediaStream();
      const old = isAudio ? this.localStream.getAudioTracks()[0] : this.localStream.getVideoTracks()[0];
      if (old) this.localStream.removeTrack(old);
      this.localStream.addTrack(next);

      const sender = this.pc?.getSenders?.().find(s => s.track?.kind === kind)
        || this.pc?.getTransceivers?.().find(t => t.receiver?.track?.kind === kind)?.sender;
      if (sender && !(kind === 'video' && this.screenTrack)) {
        try { await sender.replaceTrack(next); } catch (e) { console.warn('[Mathroom devices] replaceTrack', kind, e); }
      }
      old?.stop?.();

      if (isAudio) {
        this.selectedAudioInput = deviceId || '';
        localStorage.setItem(`mathroom.media.audioinput.${this.role}`, this.selectedAudioInput);
      } else {
        this.selectedVideoInput = deviceId || '';
        localStorage.setItem(`mathroom.media.videoinput.${this.role}`, this.selectedVideoInput);
      }
      this.bindMedia();
      await this.refreshDevices().catch(()=>{});
      this.paintPrejoin();
      if (!opts.silent) toast(isAudio ? 'Микрофон переключён' : 'Камера переключена');
      return next;
    }

    async handleDeviceChange() {
      const before = {
        audio:this.selectedAudioInput || this.currentInputDeviceId('audioinput'),
        video:this.selectedVideoInput || this.currentInputDeviceId('videoinput'),
        output:this.selectedAudioOutput
      };
      const list = await navigator.mediaDevices.enumerateDevices();
      this.devices = {
        audioinput:list.filter(x => x.kind === 'audioinput'),
        videoinput:list.filter(x => x.kind === 'videoinput'),
        audiooutput:list.filter(x => x.kind === 'audiooutput')
      };
      const has=(kind,id)=>!id || this.devices[kind].some(x => x.deviceId === id);
      const micTrack=this.localStream?.getAudioTracks?.()[0];
      const camTrack=this.localStream?.getVideoTracks?.()[0];
      const lostMic=!!micTrack && (micTrack.readyState === 'ended' || !has('audioinput',before.audio));
      const lostCam=!!camTrack && (camTrack.readyState === 'ended' || !has('videoinput',before.video));
      const lostOut=!!before.output && !has('audiooutput',before.output);

      if (lostMic && this.devices.audioinput.length) {
        this.selectedAudioInput='';
        localStorage.removeItem(`mathroom.media.audioinput.${this.role}`);
        await this.switchInputDevice('audio','',{silent:true}).catch(()=>{});
        toast('Микрофон отключён · Mathroom переключился на доступный');
      }
      if (lostCam && this.devices.videoinput.length) {
        this.selectedVideoInput='';
        localStorage.removeItem(`mathroom.media.videoinput.${this.role}`);
        await this.switchInputDevice('video','',{silent:true}).catch(()=>{});
        toast('Камера отключена · Mathroom переключился на доступную');
      }
      if (lostOut) {
        this.selectedAudioOutput='';
        localStorage.removeItem(`mathroom.media.audiooutput.${this.role}`);
        await this.setAudioOutput('',true);
        toast('Устройство звука отключено · используется системный вывод');
      }
      this.refreshDeviceUi();
    }

    async openDeviceSettings() {
      await this.refreshDevices().catch(()=>{});
      const m=modal(`<div class="mr-card-head"><div><span class="pill">Связь</span><h2 style="margin:8px 0 4px">Камера и звук</h2><p class="muted">Можно переключать устройства прямо во время урока — переподключаться не нужно.</p></div></div>
        <div class="mr-device-modal-grid">
          <div class="mr-media-device-field"><label>Микрофон</label><select data-device-kind="audioinput"></select></div>
          <div class="mr-media-device-field"><label>Камера</label><select data-device-kind="videoinput"></select></div>
          <div class="mr-media-device-field"><label>Вывод звука</label><select data-device-kind="audiooutput"></select></div>
        </div>
        <div class="notice"><b>Подключение устройств отслеживается автоматически.</b><br><span class="small">Если активная камера, микрофон или наушники отключатся, Mathroom обновит список и попробует перейти на доступное устройство.</span></div>
        <div class="mr-device-count" style="margin-top:10px"></div>`,'wide-modal');
      this.deviceModal=m;
      this.bindDeviceSelects(m);
      this.refreshDeviceUi();
    }

    async acquireMedia() {
      if (this.localStream?.getTracks?.().some(t => t.readyState === 'live')) return this.localStream;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Камера и микрофон доступны только по HTTPS в современном браузере.');
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio:this.audioConstraints(),
          video:this.videoConstraints()
        });
      } catch (e) {
        if ((e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') && (this.selectedAudioInput || this.selectedVideoInput)) {
          this.selectedAudioInput=''; this.selectedVideoInput='';
          localStorage.removeItem(`mathroom.media.audioinput.${this.role}`);
          localStorage.removeItem(`mathroom.media.videoinput.${this.role}`);
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio:this.audioConstraints(''),
            video:this.videoConstraints('')
          }).catch(async fallbackError => {
            if (fallbackError?.name === 'NotFoundError' || fallbackError?.name === 'OverconstrainedError') {
              this.cameraEnabled=false;
              return navigator.mediaDevices.getUserMedia({ audio:this.audioConstraints(''), video:false });
            }
            throw fallbackError;
          });
        } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio:this.audioConstraints(''), video:false });
          this.cameraEnabled = false;
        } else throw e;
      }
      const at = this.localStream.getAudioTracks()[0];
      if (at) { at.enabled = this.micEnabled; await this.configureSpeechTrack(at); }
      const vt = this.localStream.getVideoTracks()[0]; if (vt) vt.enabled = this.cameraEnabled;
      await this.refreshDevices().catch(()=>{});
      this.bindMedia();
      return this.localStream;
    }
    async openPrejoin() {
      if (this.joined) return;
      if (this.prejoin) return;
      const backdrop = document.createElement('div');
      backdrop.className = 'mr-native-prejoin-backdrop';
      backdrop.innerHTML = `<div class="mr-native-prejoin">
        <div><div class="pill">Встроенная связь Mathroom</div><h2>Подключиться к уроку</h2><p class="small muted">Выбери состояние камеры и микрофона. После входа собеседника будет слышно сразу.</p></div>
        <div class="mr-native-prejoin-grid">
          <div class="mr-native-preview"><video id="mrPrejoinVideo" autoplay muted playsinline></video><span class="mr-preview-name">Вы</span></div>
          <div class="mr-native-prejoin-side">
            <button class="btn" id="mrPrejoinMic">🎙 Микрофон</button>
            <button class="btn" id="mrPrejoinCam">📹 Камера</button>
            <div class="mr-media-device-fields mr-prejoin-wide">
              <div class="mr-media-device-field"><label>Микрофон</label><select data-device-kind="audioinput"></select></div>
              <div class="mr-media-device-field"><label>Камера</label><select data-device-kind="videoinput"></select></div>
              <div class="mr-media-device-field"><label>Вывод звука</label><select data-device-kind="audiooutput"></select></div>
              <div class="mr-device-count"></div>
            </div>
            <div class="notice mr-prejoin-wide"><b>Устройства отслеживаются автоматически.</b><br><span class="small">Если подключить или отключить камеру, микрофон или наушники, список обновится без перезагрузки страницы.</span></div>
          </div>
        </div>
        <div class="mr-native-prejoin-error" id="mrPrejoinError"></div>
        <div class="mr-native-prejoin-footer"><button class="btn" id="mrPrejoinCancel">Отмена</button><button class="btn primary" id="mrPrejoinJoin">Войти в урок</button></div>
      </div>`;
      document.body.appendChild(backdrop);
      this.prejoin = backdrop;
      const err = backdrop.querySelector('#mrPrejoinError');
      const join = backdrop.querySelector('#mrPrejoinJoin');
      join.disabled = true;
      backdrop.querySelector('#mrPrejoinCancel').onclick = () => this.closePrejoin(false);
      backdrop.querySelector('#mrPrejoinMic').onclick = () => { this.micEnabled = !this.micEnabled; localStorage.setItem(`mathroom.media.mic.${this.role}`, this.micEnabled?'1':'0'); const t=this.localStream?.getAudioTracks?.()[0]; if(t)t.enabled=this.micEnabled; this.paintPrejoin(); };
      backdrop.querySelector('#mrPrejoinCam').onclick = () => { this.cameraEnabled = !this.cameraEnabled; localStorage.setItem(`mathroom.media.camera.${this.role}`, this.cameraEnabled?'1':'0'); const t=this.localStream?.getVideoTracks?.()[0]; if(t)t.enabled=this.cameraEnabled; this.paintPrejoin(); };
      join.onclick = () => this.joinCall();
      try {
        await this.acquireMedia();
        if (!this.prejoin) return;
        const video = backdrop.querySelector('#mrPrejoinVideo');
        video.srcObject = this.localStream;
        video.play().catch(() => {});
        join.disabled = false;
        this.bindDeviceSelects(backdrop);
        await this.refreshDevices().catch(()=>{});
        this.refreshDeviceUi();
        this.paintPrejoin();
      } catch (e) {
        err.textContent = e?.name === 'NotAllowedError' ? 'Доступ к камере или микрофону запрещён. Разреши его в настройках браузера и попробуй снова.' : (e?.message || 'Не удалось открыть камеру и микрофон.');
        err.classList.add('show');
      }
    }

    paintPrejoin() {
      if (!this.prejoin) return;
      const mic = this.prejoin.querySelector('#mrPrejoinMic');
      const cam = this.prejoin.querySelector('#mrPrejoinCam');
      const hasMic = !!this.localStream?.getAudioTracks?.().length;
      const hasCam = !!this.localStream?.getVideoTracks?.().length;
      if (mic) mic.textContent = `${this.micEnabled && hasMic ? '🎙' : '🔇'} Микрофон ${this.micEnabled && hasMic ? 'включён' : 'выключен'}`;
      if (cam) cam.textContent = `${this.cameraEnabled && hasCam ? '📹' : '🚫'} Камера ${this.cameraEnabled && hasCam ? 'включена' : 'выключена'}`;
      if (cam) cam.disabled = !hasCam;
    }

    closePrejoin(stopMedia = false) {
      this.prejoin?.remove();
      this.prejoin = null;
      if (stopMedia && !this.joined) {
        this.localStream?.getTracks?.().forEach(t => t.stop());
        this.localStream = null;
      }
    }

    async joinCall() {
      try {
        await this.acquireMedia();
        this.status = 'Готовим канал связи…';
        this.paint();
        await this.ensureIceServers(false);
        this.joined = true;
        this.forceRelay = false;
        this.relayEscalated = false;
        this.closePrejoin(false);
        this.createPeer();
        this.bindMedia();
        this.status = 'Вы в уроке · ждём собеседника';
        this.paint();
        await this.send(this.role === 'teacher' ? 'teacher-ready' : 'ready', { joined:true }, this.otherRole());
        await this.send('hello', { joined:true }, this.otherRole());
        this.startReadyLoop();
        this.schedulePoll(80);
        if (this.role === 'student') {
          if (this.pendingOffer) { const offer = this.pendingOffer; this.pendingOffer = null; await this.acceptOffer(offer); }
          else await this.send('need-offer', { joined:true }, 'teacher');
        } else {
          // Create an offer immediately even when the student has not announced readiness yet.
          // This removes the fragile "student joined first" timing dependency.
          await this.makeOffer(false);
        }
      } catch (e) { fail(e); }
    }

    startReadyLoop() {
      clearInterval(this.readyTimer);
      if (!this.joined || this.destroyed) return;
      this.readyTimer = setInterval(() => {
        if (this.destroyed || !this.joined || this.isConnected()) { clearInterval(this.readyTimer); this.readyTimer=null; return; }
        this.send(this.role === 'teacher' ? 'teacher-ready' : 'ready', { joined:true }, this.otherRole()).catch(() => {});
        if (this.role === 'student') this.send('need-offer', { joined:true }, 'teacher').catch(() => {});
      }, 1200);
    }

    toggleMic() {
      const t = this.localStream?.getAudioTracks?.()[0];
      if (!t) return toast('Микрофон недоступен');
      this.micEnabled = !this.micEnabled;
      t.enabled = this.micEnabled;
      localStorage.setItem(`mathroom.media.mic.${this.role}`, this.micEnabled?'1':'0');
      this.paint();
    }

    toggleCamera() {
      const t = this.localStream?.getVideoTracks?.()[0];
      if (!t) return toast('Камера недоступна');
      this.cameraEnabled = !this.cameraEnabled;
      t.enabled = this.cameraEnabled;
      localStorage.setItem(`mathroom.media.camera.${this.role}`, this.cameraEnabled?'1':'0');
      this.paint();
    }

    async shareScreen() {
      if (!this.joined) return;
      try {
        if (this.screenTrack) {
          this.screenTrack.stop();
          return;
        }
        const display = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
        const track = display.getVideoTracks()[0];
        const sender = this.pc?.getSenders?.().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(track);
        this.screenTrack = track;
        this.screenPreviewStream = new MediaStream([track]);
        this.bindMedia();
        track.onended = async () => {
          const camera = this.localStream?.getVideoTracks?.()[0] || null;
          try { if (sender) await sender.replaceTrack(camera); } catch {}
          this.screenTrack = null;
          this.screenPreviewStream = null;
          this.bindMedia();
          this.paint();
        };
        this.paint();
      } catch (e) { if (e?.name !== 'NotAllowedError') fail(e); }
    }

    async reconnect(iceRestart = false, forceRelay = false) {
      if (!this.joined || this.destroyed) return;
      this.reconnectAttempts++;
      if (this.turnExpiresAt && this.turnExpiresAt < Date.now() + 5 * 60 * 1000) await this.ensureIceServers(true);
      if (forceRelay && this.hasTurn) this.forceRelay = true;
      this.closePeer(false);
      this.status = this.forceRelay ? 'Подключаем через резервный сервер…' : 'Переподключаемся…';
      this.paint();
      this.createPeer();
      this.schedulePoll(50);
      this.startReadyLoop();
      if (this.role === 'teacher') await this.makeOffer(iceRestart);
      else await this.send('need-offer', { joined:true, reconnect:true, relay:this.forceRelay }, 'teacher');
    }

    closePeer(notify = false) {
      clearTimeout(this.connectTimer);
      clearTimeout(this.disconnectTimer);
      this.stopStats();
      if (notify) this.send('hangup', {}, this.otherRole()).catch(() => {});
      try { this.pc?.close(); } catch {}
      this.pc = null;
      this.currentOfferId = '';
      this.remoteOfferId = '';
      this.pendingIce = [];
      this.remoteStream = new MediaStream();
      this.bindMedia();
    }

    async end() {
      if (!this.joined && !this.localStream) return;
      this.send('hangup', {}, this.otherRole()).catch(() => {});
      this.joined = false;
      clearInterval(this.readyTimer); this.readyTimer = null;
      clearTimeout(this.pollTimer); this.pollTimer = null;
      this.closePeer(false);
      this.screenTrack?.stop?.(); this.screenTrack = null; this.screenPreviewStream = null;
      this.localStream?.getTracks?.().forEach(t => t.stop());
      this.localStream = null;
      this.status = 'Готов к подключению';
      this.connectionQuality = '';
      this.forceRelay = false;
      this.relayEscalated = false;
      this.routeLabel = '';
      this.paint();
      this.schedulePoll(500);
    }

    bindMedia() {
      const local = this.panel?.querySelector('#mrLocalVideo');
      const remote = this.panel?.querySelector('#mrRemoteVideo');
      const audio = this.panel?.querySelector('#mrRemoteAudio');
      if (local) {
        const preview = this.screenTrack ? (this.screenPreviewStream || new MediaStream([this.screenTrack])) : (this.localStream || null);
        if (this.screenTrack && !this.screenPreviewStream) this.screenPreviewStream = preview;
        if (local.srcObject !== preview) local.srcObject = preview;
        local.muted = true; local.playsInline = true;
        if (preview) local.play().catch(() => {});
      }
      if (remote) {
        if (remote.srcObject !== this.remoteStream) remote.srcObject = this.remoteStream;
        remote.muted = true; remote.playsInline = true;
        if (this.remoteStream.getVideoTracks().length) remote.play().catch(() => {});
      }
      if (audio) {
        if (audio.srcObject !== this.remoteStream) audio.srcObject = this.remoteStream;
        audio.muted = !this.soundEnabled; audio.volume = 1;
        if (this.outputSelectionSupported && audio.setSinkId && audio.dataset.sinkId !== this.selectedAudioOutput) {
          audio.setSinkId(this.selectedAudioOutput || '').then(() => { audio.dataset.sinkId=this.selectedAudioOutput || ''; }).catch(() => {});
        }
        if (this.remoteStream.getAudioTracks().length && this.soundEnabled) audio.play().catch(() => {
          this.status = 'Нажми 🔊, чтобы включить звук'; this.soundEnabled = false; this.paint();
        });
      }
    }

    toggleSound() {
      const audio = this.panel?.querySelector('#mrRemoteAudio');
      this.soundEnabled = !this.soundEnabled;
      localStorage.setItem(`mathroom.media.sound.${this.role}`, this.soundEnabled ? '1' : '0');
      if (audio) {
        audio.muted = !this.soundEnabled;
        if (this.soundEnabled) audio.play().then(() => { this.status = this.isConnected() ? 'Соединено' : this.status; this.paint(); }).catch(() => { this.soundEnabled = false; localStorage.setItem(`mathroom.media.sound.${this.role}`,'0'); this.paint(); toast('Браузер не разрешил воспроизведение звука'); });
      }
      this.paint();
    }

    enableSound() {
      if (this.soundEnabled) { const audio=this.panel?.querySelector('#mrRemoteAudio'); audio?.play?.().catch(()=>{}); return; }
      this.toggleSound();
    }

    toggleExpanded() {
      this.expanded = !this.expanded;
      if (this.expanded) this.minimized = false;
      localStorage.setItem(`mathroom.media.expanded.${this.role}`, this.expanded ? '1' : '0');
      this.paint();
    }

    startStats() {
      this.stopStats();
      let prevPackets = 0, prevLost = 0;
      this.statsTimer = setInterval(async () => {
        const pc = this.pc;
        if (!pc || pc.connectionState !== 'connected') return;
        try {
          const stats = await pc.getStats();
          let rtt = null, packets = 0, lost = 0, selectedPair = null;
          stats.forEach(s => {
            if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.selected || s.nominated || s.currentRoundTripTime != null)) {
              if (!selectedPair || s.selected || s.nominated) selectedPair = s;
              if (s.currentRoundTripTime != null) rtt = Math.round(s.currentRoundTripTime * 1000);
            }
            if (s.type === 'inbound-rtp' && !s.isRemote) { packets += Number(s.packetsReceived || 0); lost += Number(s.packetsLost || 0); }
          });
          if (selectedPair) {
            const local = stats.get?.(selectedPair.localCandidateId);
            const remote = stats.get?.(selectedPair.remoteCandidateId);
            const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay' || this.forceRelay;
            this.routeLabel = relay ? 'резервный маршрут' : 'прямой маршрут';
          }
          const dp = packets - prevPackets, dl = lost - prevLost; prevPackets = packets; prevLost = lost;
          const loss = dp + dl > 0 ? Math.max(0, Math.round((dl / (dp + dl)) * 1000) / 10) : 0;
          this.connectionQuality = `${this.routeLabel ? this.routeLabel + ' · ' : ''}${rtt == null ? '—' : `${rtt} мс`} · потери ${loss}%`;
          this.paint();
        } catch {}
      }, 2500);
    }

    stopStats() { clearInterval(this.statsTimer); this.statsTimer = null; }

    toggleMinimized() {
      this.minimized = !this.minimized;
      if (this.minimized) this.expanded = false;
      localStorage.setItem(`mathroom.media.minimized.${this.role}`, this.minimized?'1':'0');
      this.paint();
    }

    attachDrag() {
      const host = this.panel;
      const head = host?.querySelector('.mr-call-head');
      if (!host || !head || host.dataset.dragBound === '1') return;
      host.dataset.dragBound = '1';
      let drag = null;
      head.addEventListener('pointerdown', e => {
        if (window.matchMedia?.('(max-width:760px)')?.matches || e.target.closest('button')) return;
        const r = host.getBoundingClientRect();
        drag = { x:e.clientX, y:e.clientY, left:r.left, top:r.top };
        head.setPointerCapture?.(e.pointerId);
      });
      head.addEventListener('pointermove', e => {
        if (!drag || !this.joined) return;
        host.style.left = Math.max(6, Math.min(window.innerWidth - host.offsetWidth - 6, drag.left + e.clientX - drag.x)) + 'px';
        host.style.top = Math.max(6, Math.min(window.innerHeight - host.offsetHeight - 6, drag.top + e.clientY - drag.y)) + 'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
      });
      head.addEventListener('pointerup', () => drag = null);
    }

    renderPanel(target) {
      if (!target) return;
      let host = target.querySelector(':scope > #mrVideoPanel');
      if (!host) {
        host = document.createElement('section');
        host.id = 'mrVideoPanel';
        host.innerHTML = `<div class="mr-call-head"><div><div class="mr-call-title"><span class="mr-call-dot"></span><b>Связь урока</b><span class="pill">Mathroom P2P + TURN</span></div><div class="small muted" id="mrVideoStatus"></div></div><button class="btn sm" id="mrVideoMin" hidden>—</button></div>
          <div class="mr-call-stage" id="mrCallStage" title="Двойной клик — полноэкранный режим"><video class="mr-remote-video" id="mrRemoteVideo" autoplay muted playsinline></video><audio id="mrRemoteAudio" autoplay></audio><video class="mr-local-video" id="mrLocalVideo" autoplay muted playsinline title="Ваше видео / ваш экран"></video><span class="mr-call-person">${this.role === 'teacher' ? 'Ученик' : 'Преподаватель'}</span></div>
          <div class="mr-call-actions"><button class="btn primary" id="mrVideoJoin">Присоединиться к уроку</button><button class="btn mr-hide-min" id="mrVideoMic" hidden></button><button class="btn mr-hide-min" id="mrVideoCam" hidden></button><button class="btn mr-hide-min" id="mrVideoSound" hidden></button><button class="btn mr-hide-min mr-device-btn" id="mrVideoDevices" hidden>⚙ Устройства</button><button class="btn mr-hide-min" id="mrVideoScreen" hidden>🖥 Экран</button><button class="btn mr-hide-min" id="mrVideoExpand" hidden>⛶ Увеличить</button><button class="btn mr-hide-min" id="mrVideoReconnect" hidden>↻ Переподключить</button><button class="btn danger" id="mrVideoEnd" hidden>Выйти</button></div>
          <div class="mr-call-quality" id="mrVideoQuality"></div><div class="mr-call-note" id="mrVideoNote">Камера и микрофон выбираются перед входом. Связь встроена прямо в Mathroom.</div>`;
        target.appendChild(host);
        host.querySelector('#mrVideoJoin').onclick = () => this.openPrejoin();
        host.querySelector('#mrVideoMic').onclick = () => this.toggleMic();
        host.querySelector('#mrVideoCam').onclick = () => this.toggleCamera();
        host.querySelector('#mrVideoSound').onclick = () => this.toggleSound();
        host.querySelector('#mrVideoDevices').onclick = () => this.openDeviceSettings().catch(fail);
        host.querySelector('#mrVideoReconnect').onclick = () => { this.forceRelay = false; this.reconnect(true, false).catch(fail); };
        host.querySelector('#mrVideoEnd').onclick = () => this.end();
        host.querySelector('#mrVideoMin').onclick = () => this.toggleMinimized();
        const screen = host.querySelector('#mrVideoScreen'); if (screen) screen.onclick = () => this.shareScreen();
        const expand = host.querySelector('#mrVideoExpand'); if (expand) expand.onclick = () => this.toggleExpanded();
        const stage = host.querySelector('#mrCallStage'); if (stage) stage.ondblclick = () => stage.requestFullscreen?.().catch?.(()=>{});
        const localPreview = host.querySelector('#mrLocalVideo'); if (localPreview) localPreview.onclick = () => { if (this.screenTrack) this.toggleExpanded(); };
      }
      this.panel = host;
      this.attachDrag();
      this.bindMedia();
      this.paint();
    }

    paint() {
      const host = this.panel;
      if (!host) return;
      host.className = `mr-native-call ${this.joined ? 'joined' : ''} ${this.isConnected() ? 'connected' : ''} ${this.minimized ? 'minimized' : ''} ${this.expanded ? 'expanded' : ''} ${this.screenTrack ? 'sharing' : ''}`;
      const status = host.querySelector('#mrVideoStatus'); if (status) status.textContent = this.status;
      const q = host.querySelector('#mrVideoQuality'); if (q) q.textContent = this.connectionQuality || (this.joined ? (this.hasTurn ? 'Автоматический прямой + резервный маршрут' : 'Прямой канал · резервный сервер пока недоступен') : '');
      const join = host.querySelector('#mrVideoJoin'); if (join) join.hidden = this.joined;
      const ids = ['#mrVideoMic','#mrVideoCam','#mrVideoSound','#mrVideoDevices','#mrVideoReconnect','#mrVideoEnd','#mrVideoScreen','#mrVideoExpand'];
      ids.forEach(sel => { const el=host.querySelector(sel); if(el) el.hidden = !this.joined; });
      const min = host.querySelector('#mrVideoMin'); if (min) { min.hidden = !this.joined; min.textContent = this.minimized ? '□' : '—'; }
      const mic = host.querySelector('#mrVideoMic'); if (mic) mic.textContent = this.micEnabled ? '🎙 Вкл' : '🔇 Выкл';
      const cam = host.querySelector('#mrVideoCam'); if (cam) cam.textContent = this.cameraEnabled ? '📹 Вкл' : '🚫 Выкл';
      const sound = host.querySelector('#mrVideoSound'); if (sound) sound.textContent = this.soundEnabled ? '🔊 Звук' : '🔇 Звук';
      const screen = host.querySelector('#mrVideoScreen'); if (screen) screen.textContent = this.screenTrack ? '■ Остановить экран' : '🖥 Экран';
      const expand = host.querySelector('#mrVideoExpand'); if (expand) expand.textContent = this.expanded ? '↙ Уменьшить' : '⛶ Увеличить';
      const note = host.querySelector('#mrVideoNote'); if (note) note.textContent = this.joined
        ? (this.hasTurn ? 'Mathroom сначала использует прямую связь, а при проблемах автоматически переключается через резервный сервер.' : 'Резервный сервер сейчас недоступен: Mathroom использует прямое P2P-соединение.')
        : 'Камера и микрофон выбираются перед входом. Связь встроена прямо в Mathroom.';
      this.bindMedia();
    }

    destroy() {
      this.destroyed = true;
      this.closePrejoin(true);
      clearTimeout(this.pollTimer);
      clearInterval(this.readyTimer);
      clearTimeout(this.connectTimer);
      clearTimeout(this.disconnectTimer);
      this.stopStats();
      try { this.pc?.close(); } catch {}
      this.pc = null;
      this.localStream?.getTracks?.().forEach(t => t.stop());
      this.localStream = null;
      this.screenTrack?.stop?.();
      this.screenTrack = null;
      this.screenPreviewStream = null;
      window.removeEventListener('online', this.onOnline);
      clearTimeout(this.deviceRefreshTimer);
      navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
      if (this.deviceModal && document.body.contains(this.deviceModal)) this.deviceModal.remove();
      this.deviceModal = null;
      if (this.fastChannel) sb.removeChannel(this.fastChannel).catch?.(() => {});
      this.fastChannel = null;
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

  async function getLiveState(lessonId) {
    const { data, error } = await sb.from('lesson_live_state').select('*').eq('lesson_id', lessonId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function statusGlyph(status) {
    return status === 'solved' ? '✓' : status === 'hard' ? '⚠' : status === 'later' ? '↩' : '○';
  }

  async function setCurrentFromAddon(ctx, item) {
    const patch = item ? {
      current_queue_item_id: item.id, current_title: item.title || 'Задача', current_prompt: item.prompt || '', current_position: item.position || 0, updated_at: new Date().toISOString()
    } : { current_queue_item_id: null, current_title: '', current_prompt: '', current_position: 0, updated_at: new Date().toISOString() };
    const { error } = await sb.from('lesson_live_state').update(patch).eq('lesson_id', ctx.lessonId);
    if (error) throw error;
    window.dispatchEvent(new Event('mathroom:refresh-lesson'));
  }

  async function persistQueueOrder(ctx, ordered) {
    await Promise.all(ordered.map((item, position) => sb.from('lesson_queue_items').update({ position }).eq('id', item.id).then(({ error }) => { if (error) throw error; })));
    const live = await getLiveState(ctx.lessonId);
    if (live?.current_queue_item_id) {
      const current = ordered.find(x => x.id === live.current_queue_item_id);
      if (current) await sb.from('lesson_live_state').update({ current_position: ordered.indexOf(current), updated_at: new Date().toISOString() }).eq('lesson_id', ctx.lessonId);
    }
    window.dispatchEvent(new Event('mathroom:refresh-lesson'));
  }

  async function moveQueueCurrent(ctx, queue, currentId, delta) {
    const ordered = [...queue].sort((a,b) => (a.position || 0) - (b.position || 0));
    const i = ordered.findIndex(x => x.id === currentId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    await persistQueueOrder(ctx, ordered);
  }



  function historyKey(lessonId) { return `lesson:${lessonId}`; }

  function compactQueueState(queue = []) {
    return [...queue].sort((a,b) => (a.position || 0) - (b.position || 0)).map(x => ({
      id: x.id,
      title: x.title || 'Задача',
      status: x.status || 'pending',
      position: Number(x.position || 0),
      difficulty: x.difficulty || '',
      exercise_id: x.exercise_id || null
    }));
  }

  function compactLiveState(live = {}) {
    return {
      current_queue_item_id: live?.current_queue_item_id || null,
      focus_enabled: !!live?.focus_enabled,
      timer_running: !!live?.timer_running,
      timer_elapsed_seconds: Number(live?.timer_elapsed_seconds || 0),
      timer_started_at: live?.timer_started_at || null
    };
  }

  async function appendLessonEvents(ctx, rows = []) {
    if (!ctx || ctx.role !== 'teacher' || !rows.length) return;
    const payload = rows.map(x => ({
      teacher_id: S.user.id,
      lesson_id: ctx.lessonId,
      student_id: ctx.studentId,
      kind: x.kind,
      queue_item_id: x.queue_item_id || null,
      title: x.title || '',
      details: x.details || {}
    }));
    const { error } = await sb.from('lesson_events').insert(payload);
    if (error && !String(error.message || '').includes('lesson_events')) console.warn('[Mathroom history]', error);
  }

  async function observeLessonChanges(ctx, queue, live) {
    if (!ctx || ctx.role !== 'teacher' || historyBusy) return;
    const key = historyKey(ctx.lessonId);
    const next = { queue: compactQueueState(queue), live: compactLiveState(live) };
    const prev = historyBaseline.get(key);
    historyBaseline.set(key, next);
    if (!prev) return;
    const events = [];
    const prevById = new Map(prev.queue.map(x => [x.id, x]));
    const nextById = new Map(next.queue.map(x => [x.id, x]));
    for (const item of next.queue) {
      const old = prevById.get(item.id);
      if (!old) events.push({ kind: 'queue_added', queue_item_id: item.id, title: item.title, details: { status: item.status, position: item.position } });
      else {
        if (old.status !== item.status) events.push({ kind: 'status_changed', queue_item_id: item.id, title: item.title, details: { from: old.status, to: item.status } });
        if (old.position !== item.position) events.push({ kind: 'queue_reordered', queue_item_id: item.id, title: item.title, details: { from: old.position, to: item.position } });
      }
    }
    for (const item of prev.queue) if (!nextById.has(item.id)) events.push({ kind: 'queue_removed', queue_item_id: item.id, title: item.title, details: { status: item.status } });
    if (prev.live.current_queue_item_id !== next.live.current_queue_item_id) {
      const item = nextById.get(next.live.current_queue_item_id);
      events.push({ kind: 'current_task_changed', queue_item_id: item?.id || null, title: item?.title || '', details: { from: prev.live.current_queue_item_id, to: next.live.current_queue_item_id } });
    }
    if (prev.live.focus_enabled !== next.live.focus_enabled) events.push({ kind: 'focus_changed', title: next.live.focus_enabled ? 'Фокус ученика включён' : 'Фокус ученика выключен', details: { enabled: next.live.focus_enabled } });
    if (prev.live.timer_running !== next.live.timer_running) events.push({ kind: next.live.timer_running ? 'timer_started' : 'timer_paused', title: next.live.timer_running ? 'Таймер запущен' : 'Таймер поставлен на паузу', details: { elapsed: next.live.timer_elapsed_seconds } });
    if (next.live.timer_elapsed_seconds + 3 < prev.live.timer_elapsed_seconds) events.push({ kind: 'timer_reset', title: 'Таймер сброшен', details: { from: prev.live.timer_elapsed_seconds, to: next.live.timer_elapsed_seconds } });
    if (!events.length) return;
    historyBusy = true;
    try { await appendLessonEvents(ctx, events); } finally { historyBusy = false; }
  }

  function eventMeta(kind, details = {}) {
    const map = {
      queue_added: ['＋', 'Задача добавлена в очередь', 'queue'],
      queue_removed: ['−', 'Задача удалена из очереди', 'queue'],
      queue_reordered: ['↕', 'Очередь изменена', 'queue'],
      status_changed: ['●', 'Статус задачи изменён', 'tasks'],
      current_task_changed: ['→', 'Выбрана текущая задача', 'tasks'],
      focus_changed: ['◎', 'Режим фокуса', 'lesson'],
      timer_started: ['▶', 'Таймер запущен', 'timer'],
      timer_paused: ['Ⅱ', 'Таймер на паузе', 'timer'],
      timer_reset: ['↺', 'Таймер сброшен', 'timer'],
      lesson_started: ['▶', 'Урок открыт', 'lesson'],
      lesson_completed: ['■', 'Урок завершён', 'lesson'],
      note_checkpoint: ['✎', 'Заметка преподавателя', 'notes'],
      board_checkpoint: ['▣', 'Снимок доски', 'board'],
      queue_bulk: ['☷', 'Массовое изменение очереди', 'queue'],
      lesson_plan_updated: ['◎', 'План урока обновлён', 'lesson'],
      lesson_plan_step: ['✓', 'Этап плана урока', 'lesson'],
      attendance: ['●', 'Посещаемость', 'lesson']
    };
    return map[kind] || ['•', kind || 'Событие', 'other'];
  }

  function statusWord(status) {
    return status === 'solved' ? 'решено' : status === 'hard' ? 'сложно' : status === 'later' ? 'вернуться позже' : 'не отмечено';
  }

  function eventDescription(e) {
    const d = e.details || {};
    if (e.kind === 'status_changed') return `${statusWord(d.from)} → ${statusWord(d.to)}`;
    if (e.kind === 'queue_reordered') return `позиция ${Number(d.from) + 1} → ${Number(d.to) + 1}`;
    if (e.kind === 'focus_changed') return d.enabled ? 'Фокус ученика включён' : 'Фокус ученика выключен';
    if (e.kind === 'timer_started' || e.kind === 'timer_paused') return `время: ${Math.floor(Number(d.elapsed || 0) / 60)} мин`;
    if (e.kind === 'timer_reset') return `было ${Math.floor(Number(d.from || 0) / 60)} мин`;
    if (e.kind === 'note_checkpoint') return String(d.text || '').slice(0, 180);
    if (e.kind === 'queue_bulk') return String(d.action || 'Очередь обновлена');
    if (e.kind === 'lesson_plan_updated') return `этапов: ${Number(d.agenda_items || 0)}`;
    if (e.kind === 'lesson_plan_step') return d.done ? 'этап выполнен' : 'отметка снята';
    if (e.kind === 'attendance') return `${attendanceMeta(d.status)[0]}${d.actual_minutes!=null?` · ${d.actual_minutes} мин`:''}${d.note?` · ${d.note}`:''}`;
    return '';
  }

  async function ensureLessonStartedEvent(ctx) {
    if (!ctx || ctx.role !== 'teacher') return;
    try {
      const { data, error } = await sb.from('lesson_events').select('id').eq('lesson_id', ctx.lessonId).eq('kind', 'lesson_started').limit(1);
      if (error || (data || []).length) return;
      await appendLessonEvents(ctx, [{ kind: 'lesson_started', title: ctx.lesson?.topics?.title || 'Урок', details: { started_at: ctx.lesson?.started_at || new Date().toISOString() } }]);
    } catch {}
  }

  async function openLessonHistory(ctx) {
    try {
      const [{ data: events, error }, { data: versions, error: verError }] = await Promise.all([
        sb.from('lesson_events').select('*').eq('lesson_id', ctx.lessonId).order('created_at', { ascending: false }).limit(300),
        sb.from('lesson_board_versions').select('*').eq('lesson_id', ctx.lessonId).order('created_at', { ascending: false })
      ]);
      if (error) throw error; if (verError) throw verError;
      const timeline = [
        ...(events || []).map(x => ({ ...x, source: 'event' })),
        ...(versions || []).map(v => ({ id: `board-${v.id}`, source: 'board', kind: 'board_checkpoint', title: v.title || 'Снимок доски', details: { note: v.note || '' }, created_at: v.created_at }))
      ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      const counts = { tasks: 0, queue: 0, timer: 0, board: 0, notes: 0, lesson: 0, other: 0 };
      timeline.forEach(e => { const cat = eventMeta(e.kind)[2]; counts[cat] = (counts[cat] || 0) + 1; });
      const rowHtml = e => {
        const [icon, label, cat] = eventMeta(e.kind, e.details);
        const time = new Date(e.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const desc = e.source === 'board' ? (e.details?.note || 'Сохранённая версия доски') : eventDescription(e);
        return `<div class="mr-history-row" data-history-cat="${cat}"><div class="mr-history-icon">${icon}</div><div class="mr-history-main"><div class="mr-history-top"><b>${esc(e.title || label)}</b><span>${time}</span></div><div class="small muted">${esc(label)}${desc ? ' · ' + esc(desc) : ''}</div></div></div>`;
      };
      const m = modal(`<div class="mr-history-head"><div><h2>История урока</h2><p class="muted">Хронология задач, таймера, заметок и снимков доски.</p></div><div class="actions"><button class="btn sm" id="mrHistoryCopy">Скопировать сводку</button>${ctx.role==='teacher'?'<button class="btn sm danger" id="mrHistoryClear">Удалить историю</button>':''}</div></div><div class="mr-history-stats"><span>Задачи: ${counts.tasks}</span><span>Очередь: ${counts.queue}</span><span>Таймер: ${counts.timer}</span><span>Доска: ${counts.board}</span><span>Заметки: ${counts.notes}</span></div><div class="mr-history-filters"><button class="btn sm active" data-history-filter="all">Все</button><button class="btn sm" data-history-filter="tasks">Задачи</button><button class="btn sm" data-history-filter="queue">Очередь</button><button class="btn sm" data-history-filter="timer">Таймер</button><button class="btn sm" data-history-filter="board">Доска</button><button class="btn sm" data-history-filter="notes">Заметки</button></div><div class="mr-history-list">${timeline.length ? timeline.map(rowHtml).join('') : '<div class="empty">Событий пока нет. Они начнут накапливаться во время урока.</div>'}</div>`, 'wide-modal');
      m.querySelectorAll('[data-history-filter]').forEach(btn => btn.onclick = () => {
        const f = btn.dataset.historyFilter;
        m.querySelectorAll('[data-history-filter]').forEach(x => x.classList.toggle('active', x === btn));
        m.querySelectorAll('[data-history-cat]').forEach(row => row.style.display = f === 'all' || row.dataset.historyCat === f ? '' : 'none');
      });
      const clear = m.querySelector('#mrHistoryClear'); if (clear) clear.onclick = async () => {
        if (!confirm('Удалить историю этого урока? Будут удалены события и сохранённые версии доски. Сам урок и его задания останутся.')) return;
        clear.disabled = true;
        try {
          const [{ error: evErr }, { error: verErr }] = await Promise.all([
            sb.from('lesson_events').delete().eq('lesson_id', ctx.lessonId),
            sb.from('lesson_board_versions').delete().eq('lesson_id', ctx.lessonId)
          ]);
          if (evErr) throw evErr; if (verErr) throw verErr;
          historyBaseline.delete(historyKey(ctx.lessonId));
          m.remove(); toast('История урока удалена');
        } catch (e) { clear.disabled = false; fail(e); }
      };
      const copy = m.querySelector('#mrHistoryCopy'); if (copy) copy.onclick = async () => {
        const text = timeline.slice().reverse().map(e => {
          const [, label] = eventMeta(e.kind, e.details); const t = new Date(e.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const desc = e.source === 'board' ? (e.details?.note || '') : eventDescription(e);
          return `[${t}] ${label}${e.title ? ': ' + e.title : ''}${desc ? ' — ' + desc : ''}`;
        }).join('\n');
        try { await navigator.clipboard.writeText(text); toast('История скопирована'); } catch { toast('Не удалось скопировать'); }
      };
    } catch (e) { fail(e); }
  }

  async function queueBulkStatus(ctx, ids, status) {
    if (!ids.length) return;
    const { error } = await sb.from('lesson_queue_items').update({ status }).in('id', ids); if (error) throw error;
    await appendLessonEvents(ctx, [{ kind: 'queue_bulk', title: 'Массовый статус', details: { action: `${ids.length} задач → ${statusWord(status)}`, ids, status } }]);
    window.dispatchEvent(new Event('mathroom:refresh-lesson'));
  }

  async function queueRemove(ctx, ids) {
    if (!ids.length) return;
    const { error } = await sb.from('lesson_queue_items').delete().in('id', ids); if (error) throw error;
    await appendLessonEvents(ctx, [{ kind: 'queue_bulk', title: 'Задачи удалены из очереди', details: { action: `Удалено задач: ${ids.length}`, ids } }]);
    window.dispatchEvent(new Event('mathroom:refresh-lesson'));
  }

  async function openQueueManager(ctx) {
    try {
      let queue = await getQueue(ctx.lessonId);
      const m = modal(`<div class="mr-queue-manager-head"><div><h2>Очередь задач</h2><p class="muted">Поиск, фильтры и массовые действия без выхода из урока.</p></div><span class="pill" id="mrQueueCount"></span></div><div class="mr-queue-manager-tools"><input class="search" id="mrQueueSearch" placeholder="Поиск по названию или условию"><select class="search" id="mrQueueStatus"><option value="all">Все статусы</option><option value="pending">Не отмечено</option><option value="solved">Решено</option><option value="hard">Сложно</option><option value="later">Позже</option></select><select class="search" id="mrQueueDifficulty"><option value="all">Любая сложность</option><option value="basic">Базовая</option><option value="medium">Средняя</option><option value="advanced">Сложная</option></select></div><div class="actions mr-queue-manager-actions"><button class="btn sm" id="mrQueueAll">Выбрать видимые</button><button class="btn sm" data-bulk-status="solved">✓ Решено</button><button class="btn sm" data-bulk-status="hard">⚠ Сложно</button><button class="btn sm" data-bulk-status="later">↩ Позже</button><button class="btn sm" data-bulk-status="pending">○ Сбросить</button><button class="btn sm" id="mrQueuePendingFirst">Нерешённые вверх</button><button class="btn sm" id="mrQueueLaterEnd">«Позже» в конец</button><button class="btn sm" id="mrQueueShufflePending">Перемешать нерешённые</button><button class="btn sm danger" id="mrQueueRemove">Удалить выбранные</button></div><div class="mr-queue-manager-list" id="mrQueueManagerList"></div>`, 'wide-modal');
      const search = m.querySelector('#mrQueueSearch'), status = m.querySelector('#mrQueueStatus'), difficulty = m.querySelector('#mrQueueDifficulty'), list = m.querySelector('#mrQueueManagerList'), count = m.querySelector('#mrQueueCount');
      const selected = new Set();
      const visibleRows = () => [...list.querySelectorAll('[data-qid]')].filter(x => x.style.display !== 'none');
      const render = () => {
        const q = String(search.value || '').trim().toLowerCase(), st = status.value, df = difficulty.value;
        const ordered = [...queue].sort((a,b) => (a.position || 0) - (b.position || 0));
        list.innerHTML = ordered.map((x,i) => {
          const hay = `${x.title || ''} ${x.prompt || ''}`.toLowerCase(); const show = (!q || hay.includes(q)) && (st === 'all' || x.status === st) && (df === 'all' || x.difficulty === df);
          return `<label class="mr-qm-row ${x.status || 'pending'}" data-qid="${x.id}" style="${show ? '' : 'display:none'}"><input type="checkbox" ${selected.has(x.id) ? 'checked' : ''}><span class="mr-qm-num">${i+1}</span><span class="mr-qm-body"><b>${esc(x.title || 'Задача')}</b><small>${esc(String(x.prompt || '').replace(/\s+/g,' ').slice(0,150))}</small></span><span class="pill">${statusGlyph(x.status)} ${statusWord(x.status)}</span><span class="pill">${esc(MR.diffLabel ? MR.diffLabel(x.difficulty) : (x.difficulty || '—'))}</span></label>`;
        }).join('') || '<div class="empty">Очередь пуста.</div>';
        list.querySelectorAll('[data-qid] input').forEach(ch => ch.onchange = () => { const id = ch.closest('[data-qid]').dataset.qid; ch.checked ? selected.add(id) : selected.delete(id); updateCount(); });
        updateCount();
      };
      const updateCount = () => { if (count) count.textContent = `${selected.size} выбрано · ${visibleRows().length} видно · ${queue.length} всего`; };
      [search,status,difficulty].forEach(el => el.oninput = render); render();
      m.querySelector('#mrQueueAll').onclick = () => { const rows = visibleRows(); const all = rows.length && rows.every(r => selected.has(r.dataset.qid)); rows.forEach(r => all ? selected.delete(r.dataset.qid) : selected.add(r.dataset.qid)); render(); };
      m.querySelectorAll('[data-bulk-status]').forEach(b => b.onclick = async () => { try { await queueBulkStatus(ctx, [...selected], b.dataset.bulkStatus); queue = await getQueue(ctx.lessonId); render(); } catch(e){ fail(e); } });
      const reorder = async (fn, label) => { try { const ordered = fn([...queue].sort((a,b)=>(a.position||0)-(b.position||0))); await persistQueueOrder(ctx, ordered); await appendLessonEvents(ctx, [{ kind:'queue_bulk', title:'Очередь перестроена', details:{ action:label } }]); queue = await getQueue(ctx.lessonId); render(); } catch(e){ fail(e); } };
      m.querySelector('#mrQueuePendingFirst').onclick = () => reorder(arr => [...arr.filter(x=>x.status!=='solved'), ...arr.filter(x=>x.status==='solved')], 'Нерешённые перемещены вверх');
      m.querySelector('#mrQueueLaterEnd').onclick = () => reorder(arr => [...arr.filter(x=>x.status!=='later'), ...arr.filter(x=>x.status==='later')], 'Отложенные задачи перемещены в конец');
      m.querySelector('#mrQueueShufflePending').onclick = () => reorder(arr => { const slots=arr.map((x,i)=>x.status==='pending'?i:-1).filter(i=>i>=0), items=shuffle(arr.filter(x=>x.status==='pending')); const out=[...arr]; slots.forEach((slot,i)=>out[slot]=items[i]); return out; }, 'Нерешённые задачи перемешаны');
      m.querySelector('#mrQueueRemove').onclick = async () => { if (!selected.size) return toast('Выбери задачи'); if (!confirm(`Удалить из очереди: ${selected.size}?`)) return; try { await queueRemove(ctx,[...selected]); selected.clear(); queue=await getQueue(ctx.lessonId); render(); } catch(e){ fail(e); } };
    } catch (e) { fail(e); }
  }

  function noteStorageKey(lessonId) { return `mathroom.quick-note.${lessonId}`; }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length, end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  function setupQuickNotes(ctx, host, current) {
    const ta = host.querySelector('#mrQuickTeacherNote');
    if (!ta) return;
    const lessonId = ctx.lessonId;
    if (noteLessonId !== lessonId || !ta.dataset.ready) {
      noteLessonId = lessonId;
      let local = '';
      try { local = localStorage.getItem(noteStorageKey(lessonId)) || ''; } catch {}
      ta.value = local || ctx.lesson?.private_notes || '';
      ta.dataset.ready = '1';
      ta.oninput = () => {
        const value = ta.value;
        try { localStorage.setItem(noteStorageKey(lessonId), value); } catch {}
        const status = host.querySelector('#mrNotesStatus'); if (status) status.textContent = 'Сохраняем…';
        clearTimeout(noteSaveTimer);
        noteSaveTimer = setTimeout(async () => {
          const { error } = await sb.from('lessons').update({ private_notes: value }).eq('id', lessonId);
          if (error) { if (status) status.textContent = 'Ошибка сохранения'; return console.warn(error); }
          const row = (S.lessons || []).find(x => x.id === lessonId); if (row) row.private_notes = value;
          if (S.activeLesson?.id === lessonId) S.activeLesson.private_notes = value;
          if (status) status.textContent = 'Сохранено';
        }, 850);
      };
      host.querySelector('#mrNoteTime').onclick = () => {
        const stamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        insertAtCursor(ta, `${ta.value && !ta.value.endsWith('\n') ? '\n' : ''}[${stamp}] `);
      };
    }
    const curBtn = host.querySelector('#mrNoteCurrent');
    if (curBtn) curBtn.onclick = () => {
      if (!current) return toast('Сначала выбери текущую задачу');
      const stamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      insertAtCursor(ta, `${ta.value && !ta.value.endsWith('\n') ? '\n' : ''}[${stamp}] ${current.title || 'Задача'}: `);
    };
    const checkpoint = host.querySelector('#mrNoteCheckpoint');
    if (checkpoint) checkpoint.onclick = async () => {
      const text = String(ta.value || '').trim(); if (!text) return toast('Заметка пустая');
      try { await appendLessonEvents(ctx, [{ kind: 'note_checkpoint', title: current?.title || 'Заметка', details: { text: text.slice(-1000) } }]); toast('Заметка добавлена в историю'); } catch (e) { fail(e); }
    };
  }

  async function refreshBoardCompanion(ctx, queue, live) {
    const boardRoot = document.querySelector('#lessonBoard');
    if (!boardRoot) return;
    let host = document.querySelector('#mrBoardCompanion');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mrBoardCompanion';
      host.className = 'mr-board-companion';
      boardRoot.parentElement.insertBefore(host, boardRoot);
      host.innerHTML = `
        <section class="mr-pinned-task-card">
          <div class="mr-pinned-head"><div><div class="lesson-task-kicker">Закреплено рядом с доской</div><b>Текущая задача</b></div><button class="btn sm" id="mrPinnedCollapse">Свернуть</button></div>
          <div id="mrPinnedTaskBody"></div>
          <div class="mr-queue-cockpit">
            <select id="mrQueueSelect" class="search"></select>
            <div class="actions mr-queue-nav">
              <button class="btn sm" id="mrPrevTask">← Пред.</button><button class="btn sm" id="mrNextTask">След. →</button><button class="btn sm" id="mrNextOpen">След. нерешённая</button>
              <button class="btn sm" id="mrMoveUp" title="Поднять в очереди">↑</button><button class="btn sm" id="mrMoveDown" title="Опустить в очереди">↓</button>
            </div>
            <div class="actions mr-quick-status">
              <button class="btn sm" data-mr-status="solved">✓ Решено</button><button class="btn sm" data-mr-status="hard">⚠ Сложно</button><button class="btn sm" data-mr-status="later">↩ Позже</button><button class="btn sm" data-mr-status="pending">○ Сбросить</button><button class="btn sm" id="mrPinnedToBoard">На доску</button>
            </div>
          </div>
        </section>
        <section class="mr-quick-notes-card">
          <div class="mr-note-head"><div><div class="lesson-task-kicker">Только преподавателю</div><b>Быстрые заметки</b></div><span class="small muted" id="mrNotesStatus">Автосохранение</span></div>
          <textarea id="mrQuickTeacherNote" placeholder="Например: путает знаки; вернуться к №7; хорошо понял теорему Виета…"></textarea>
          <div class="actions"><button class="btn sm" id="mrNoteTime">+ Время</button><button class="btn sm" id="mrNoteCurrent">+ Текущая задача</button><button class="btn sm" id="mrNoteCheckpoint">Зафиксировать</button></div>
        </section>`;
      const collapseKey = `mathroom.board-companion.collapsed.${S.user?.id || 'teacher'}`;
      const applyCollapsed = () => { let collapsed = true; try { collapsed = localStorage.getItem(collapseKey) !== '0'; } catch {} host.classList.toggle('collapsed', collapsed); host.querySelector('#mrPinnedCollapse').textContent = collapsed ? 'Развернуть' : 'Свернуть'; };
      host.querySelector('#mrPinnedCollapse').onclick = () => { try { localStorage.setItem(collapseKey, host.classList.contains('collapsed') ? '0' : '1'); } catch {} applyCollapsed(); };
      applyCollapsed();
    }

    const ordered = [...queue].sort((a,b) => (a.position || 0) - (b.position || 0));
    const current = ordered.find(x => x.id === live?.current_queue_item_id) || null;
    const body = host.querySelector('#mrPinnedTaskBody');
    const bodyHtml = current ? `<h3>${esc(current.title || 'Задача')}</h3><div class="mr-pinned-prompt">${String(current.prompt || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div><div class="small muted">${statusGlyph(current.status)} ${current.status === 'solved' ? 'решено' : current.status === 'hard' ? 'сложно' : current.status === 'later' ? 'вернуться позже' : 'не отмечено'} · Ответ: ${esc(current.correct_answer || '—')}</div>` : '<div class="muted">Выбери задачу из очереди — она останется закреплена рядом с доской.</div>';
    if (body && body.innerHTML !== bodyHtml) body.innerHTML = bodyHtml;

    const select = host.querySelector('#mrQueueSelect');
    const options = `<option value="">${ordered.length ? 'Выбрать задачу…' : 'Очередь пуста'}</option>` + ordered.map((x, i) => `<option value="${x.id}" ${x.id === current?.id ? 'selected' : ''}>${statusGlyph(x.status)} ${i + 1}. ${esc(x.title || 'Задача')}</option>`).join('');
    if (select && select.innerHTML !== options) select.innerHTML = options;
    select.onchange = async () => { const item = ordered.find(x => x.id === select.value); if (item) try { await setCurrentFromAddon(ctx, item); } catch (e) { fail(e); } };

    const index = current ? ordered.findIndex(x => x.id === current.id) : -1;
    const choose = async item => { if (!item) return; try { await setCurrentFromAddon(ctx, item); } catch (e) { fail(e); } };
    host.querySelector('#mrPrevTask').onclick = () => choose(index > 0 ? ordered[index - 1] : ordered.at(-1));
    host.querySelector('#mrNextTask').onclick = () => choose(index >= 0 ? ordered[(index + 1) % Math.max(ordered.length, 1)] : ordered[0]);
    host.querySelector('#mrNextOpen').onclick = () => {
      if (!ordered.length) return;
      const start = index >= 0 ? index : -1;
      for (let step = 1; step <= ordered.length; step++) { const item = ordered[(start + step) % ordered.length]; if (item.status !== 'solved') return choose(item); }
      toast('Все задачи отмечены как решённые');
    };
    host.querySelector('#mrMoveUp').onclick = async () => { if (current) try { await moveQueueCurrent(ctx, ordered, current.id, -1); } catch (e) { fail(e); } };
    host.querySelector('#mrMoveDown').onclick = async () => { if (current) try { await moveQueueCurrent(ctx, ordered, current.id, 1); } catch (e) { fail(e); } };
    host.querySelectorAll('[data-mr-status]').forEach(b => {
      b.classList.toggle('active', current?.status === b.dataset.mrStatus);
      b.onclick = async () => { if (!current) return toast('Выбери текущую задачу'); const { error } = await sb.from('lesson_queue_items').update({ status: b.dataset.mrStatus }).eq('id', current.id); if (error) return fail(error); window.dispatchEvent(new Event('mathroom:refresh-lesson')); };
    });
    const toBoard = host.querySelector('#mrPinnedToBoard');
    toBoard.onclick = () => { if (!current) return toast('Выбери текущую задачу'); if (!S.boardController?.addText) return toast('Доска ещё загружается'); S.boardController.addText(`${current.title || 'Задача'}\n${current.prompt || ''}`, { fontSize: 25 }); };
    setupQuickNotes(ctx, host, current);
  }

  function compactTeacherLessonChrome() {
    const control = document.querySelector('#lessonControl');
    if (!control) return;
    control.classList.add('mr-lesson-control-compact');
    const queue = control.querySelector('.lesson-queue');
    if (queue && !queue.dataset.compactInit) { queue.removeAttribute('open'); queue.dataset.compactInit='1'; }

    const topActions = document.querySelector('#leaveLesson')?.closest('.actions');
    if (topActions && !topActions.classList.contains('mr-lesson-top-actions')) {
      topActions.classList.add('mr-lesson-top-actions');
      const copy = topActions.querySelector('#copyLessonLink'), save = topActions.querySelector('#saveVersion');
      if (copy || save) {
        const more = document.createElement('details'); more.className='mr-lesson-top-more';
        more.innerHTML='<summary class="btn">Ещё</summary><div class="mr-lesson-top-more-pop"></div>';
        topActions.insertBefore(more, topActions.querySelector('#completeLesson'));
        const pop = more.querySelector('.mr-lesson-top-more-pop'); if (copy) pop.appendChild(copy); if (save) pop.appendChild(save);
      }
    }

    const layout = document.querySelector('.lesson-cloud-layout');
    const material = layout?.querySelector(':scope > .lesson-cloud-material');
    const boardRoot = document.querySelector('#lessonBoard');
    const boardWrap = boardRoot?.parentElement;
    if (layout && boardWrap) boardWrap.classList.add('mr-lesson-board-main');
    if (layout && material && !layout.querySelector(':scope > .mr-lesson-materials-drawer')) {
      const drawer = document.createElement('details'); drawer.className='mr-lesson-materials-drawer';
      drawer.innerHTML='<summary><span><b>Материалы урока</b><small>теория · примеры · задачи</small></span><span>Открыть</span></summary>';
      layout.appendChild(drawer); drawer.appendChild(material);
    }
  }

  async function refreshTeacherAddon(ctx) {
    if (addonBusy) return; addonBusy = true;
    try {
      const control = document.querySelector('#lessonControl'); if (!control) return;
      compactTeacherLessonChrome();
      let host = document.querySelector('#mrLessonAddon');
      const [queue, live] = await Promise.all([getQueue(ctx.lessonId), getLiveState(ctx.lessonId)]);
      observeLessonChanges(ctx, queue, live).catch(e => console.warn('[Mathroom history]', e));
      if (!host) {
        host = document.createElement('div'); host.id = 'mrLessonAddon'; host.className = 'mr-lesson-addon'; control.insertAdjacentElement('afterend', host);
        host.innerHTML = `<div id="mrTeacherVideoMount"></div><details class="mr-lesson-tools-drawer"><summary><span>Дополнительные инструменты урока</span><small>план · очередь · история · шаблоны</small></summary><div class="mr-addon-toolbar"><div id="mrProgressMount"></div><div class="actions"><button class="btn sm" id="mrQuickPlan">⚡ Быстрый план</button><button class="btn sm" id="mrLessonPlan">◎ Цели и план</button><button class="btn sm" id="mrQueueManager">☷ Очередь</button><button class="btn sm" id="mrLessonHistory">История урока</button><button class="btn sm" id="mrSaveTemplate">Сохранить очередь</button><button class="btn sm" id="mrOpenTemplates">Шаблоны</button></div></div><div id="mrLessonPlanMount"></div></details>`;
        host.querySelector('#mrQuickPlan').onclick = () => quickPlan(ctx);
        host.querySelector('#mrLessonPlan').onclick = () => openLessonPlan(ctx);
        host.querySelector('#mrQueueManager').onclick = () => openQueueManager(ctx);
        host.querySelector('#mrLessonHistory').onclick = () => openLessonHistory(ctx);
        host.querySelector('#mrSaveTemplate').onclick = () => saveCurrentTemplate(ctx);
        host.querySelector('#mrOpenTemplates').onclick = () => openTemplates(ctx);
      }
      const progress = host.querySelector('#mrProgressMount'); const progressMarkup = progressHtml(queue); if (progress && progress.innerHTML !== progressMarkup) progress.innerHTML = progressMarkup;
      await renderLessonPlanMount(ctx, host);
      await refreshBoardCompanion(ctx, queue, live);
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



  // ---- Cumulative WIP: student goals, lesson plan, parent reports ----
  const goalStatusLabel = v => v === 'completed' ? 'Завершена' : v === 'paused' ? 'На паузе' : 'Активна';
  const clampPct = v => Math.max(0, Math.min(100, Number(v || 0)));
  const localDate = v => v ? new Date(v).toLocaleDateString('ru-RU') : 'без срока';

  async function getStudentGoals(studentId, all = true) {
    let q = sb.from('student_goals').select('*').eq('student_id', studentId).order('created_at', { ascending: false });
    if (!all) q = q.eq('status', 'active');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  function goalProgressHtml(goal) {
    const p = clampPct(goal.progress);
    return `<div class="mr-goal-progress"><i style="width:${p}%"></i></div><div class="small muted">${p}% · ${goalStatusLabel(goal.status)}${goal.target_date ? ` · до ${localDate(goal.target_date)}` : ''}</div>`;
  }

  async function openGoalEditor(studentId, goal = null) {
    const g = goal || { title: '', description: '', progress: 0, status: 'active', target_date: '', visible_to_student: true };
    const m = modal(`<h2>${goal ? 'Изменить цель' : 'Новая цель ученика'}</h2>
      <div class="field"><label>Цель</label><input id="mrGoalTitle" value="${esc(g.title || '')}" placeholder="Например: уверенно решать квадратные уравнения"></div>
      <div class="field"><label>Критерий / комментарий</label><textarea id="mrGoalDescription" rows="3" placeholder="Что будет означать, что цель достигнута">${esc(g.description || '')}</textarea></div>
      <div class="grid cols2"><div class="field"><label>Прогресс, %</label><input id="mrGoalProgress" type="number" min="0" max="100" value="${clampPct(g.progress)}"></div><div class="field"><label>Срок</label><input id="mrGoalDate" type="date" value="${esc(g.target_date || '')}"></div></div>
      <div class="grid cols2"><div class="field"><label>Статус</label><select id="mrGoalStatus"><option value="active" ${g.status==='active'?'selected':''}>Активна</option><option value="paused" ${g.status==='paused'?'selected':''}>На паузе</option><option value="completed" ${g.status==='completed'?'selected':''}>Завершена</option></select></div><label class="mr-checkline"><input id="mrGoalVisible" type="checkbox" ${g.visible_to_student !== false ? 'checked' : ''}> Показывать ученику</label></div>
      <div class="actions"><button class="btn primary" id="mrGoalSave">Сохранить</button>${goal ? '<button class="btn danger" id="mrGoalDelete">Удалить</button>' : ''}</div>`, 'wide-modal');
    m.querySelector('#mrGoalSave').onclick = async () => {
      try {
        const title = m.querySelector('#mrGoalTitle').value.trim();
        if (!title) return toast('Заполни название цели');
        const status = m.querySelector('#mrGoalStatus').value;
        const progress = status === 'completed' ? 100 : clampPct(m.querySelector('#mrGoalProgress').value);
        const payload = {
          teacher_id: S.user.id,
          student_id: studentId,
          title,
          description: m.querySelector('#mrGoalDescription').value.trim(),
          progress,
          status,
          target_date: m.querySelector('#mrGoalDate').value || null,
          visible_to_student: m.querySelector('#mrGoalVisible').checked,
          updated_at: new Date().toISOString(),
          completed_at: status === 'completed' ? (goal?.completed_at || new Date().toISOString()) : null
        };
        const res = goal ? await sb.from('student_goals').update(payload).eq('id', goal.id) : await sb.from('student_goals').insert(payload);
        if (res.error) throw res.error;
        m.remove();
        document.querySelector('#mrGoalsOverview')?.remove();
        await enhanceTeacherProfile();
        toast(goal ? 'Цель обновлена' : 'Цель добавлена');
      } catch (e) { fail(e); }
    };
    const del = m.querySelector('#mrGoalDelete');
    if (del) del.onclick = async () => {
      if (!confirm('Удалить эту цель?')) return;
      const { error } = await sb.from('student_goals').delete().eq('id', goal.id);
      if (error) return fail(error);
      m.remove(); document.querySelector('#mrGoalsOverview')?.remove(); await enhanceTeacherProfile(); toast('Цель удалена');
    };
  }

  async function openGoalsManager(studentId) {
    try {
      const goals = await getStudentGoals(studentId, true);
      const m = modal(`<div class="mr-card-head"><div><h2>Цели ученика</h2><p class="muted">Долгосрочные ориентиры, которые можно связать с планом конкретного урока.</p></div><button class="btn primary" id="mrAddGoal">+ Цель</button></div>
        <div class="mr-goal-list">${goals.length ? goals.map(g => `<div class="mr-goal-row ${g.status}"><div><div class="mr-goal-title"><b>${esc(g.title)}</b>${g.visible_to_student ? '<span class="pill">видит ученик</span>' : '<span class="pill">только преподаватель</span>'}</div>${g.description ? `<p class="small muted">${esc(g.description)}</p>` : ''}${goalProgressHtml(g)}</div><button class="btn sm" data-edit-goal="${g.id}">Изменить</button></div>`).join('') : '<div class="empty">Целей пока нет.</div>'}</div>`, 'wide-modal');
      m.querySelector('#mrAddGoal').onclick = () => { m.remove(); openGoalEditor(studentId); };
      m.querySelectorAll('[data-edit-goal]').forEach(b => b.onclick = () => { const g = goals.find(x => x.id === b.dataset.editGoal); m.remove(); if (g) openGoalEditor(studentId, g); });
    } catch (e) { fail(e); }
  }

  async function getLessonPlan(lessonId) {
    const { data, error } = await sb.from('lesson_plans').select('*').eq('lesson_id', lessonId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function agendaToText(agenda = []) {
    return (Array.isArray(agenda) ? agenda : []).map(x => `${Number(x.minutes || 0) || ''}${x.minutes ? ' | ' : ''}${x.title || ''}`).join('\n');
  }

  function parseAgenda(text = '', old = []) {
    const oldByTitle = new Map((Array.isArray(old) ? old : []).map(x => [String(x.title || '').trim().toLowerCase(), !!x.done]));
    return String(text || '').split(/\n+/).map(x => x.trim()).filter(Boolean).map((line, i) => {
      const m = line.match(/^\s*(\d{1,3})\s*[|—-]\s*(.+)$/);
      const title = (m ? m[2] : line).trim();
      return { title, minutes: m ? Number(m[1]) : 0, done: oldByTitle.get(title.toLowerCase()) || false, position: i };
    });
  }

  async function autoFillLessonPlan(ctx, m) {
    try {
      const [{ data: lastReports }, goals] = await Promise.all([
        sb.from('lesson_reports').select('public_focus,public_highlights,created_at').eq('student_id', ctx.studentId).order('created_at', { ascending: false }).limit(1),
        getStudentGoals(ctx.studentId, false)
      ]);
      const last = (lastReports || [])[0];
      const topic = ctx.lesson?.topics?.title || S.topics?.find(x => x.id === ctx.lesson?.topic_id)?.title || 'тему урока';
      const active = goals.slice(0, 3).map(x => x.title);
      m.querySelector('#mrPlanMainGoal').value = active[0] || `Закрепить: ${topic}`;
      const objectives = [];
      if (last?.public_focus) objectives.push(last.public_focus.replace(/^Повторить:\s*/i, '').trim());
      objectives.push(`Отработать ключевые задачи по теме «${topic}»`);
      m.querySelector('#mrPlanObjectives').value = [...new Set(objectives.filter(Boolean))].join('\n');
      if (!m.querySelector('#mrPlanAgenda').value.trim()) m.querySelector('#mrPlanAgenda').value = '10 | Разминка и проверка прошлого материала\n35 | Основная практика\n10 | Разбор сложного места\n5 | Итоги и домашняя работа';
      toast('Черновик плана собран из текущей темы и прошлой аналитики');
    } catch (e) { fail(e); }
  }

  async function openLessonPlan(ctx) {
    try {
      const [plan, goals] = await Promise.all([getLessonPlan(ctx.lessonId), getStudentGoals(ctx.studentId, false)]);
      const p = plan || { main_goal: '', objectives: [], agenda: [], homework_intent: '', teacher_note: '', goal_ids: [] };
      const selected = new Set(p.goal_ids || []);
      const m = modal(`<div class="mr-card-head"><div><h2>Цели и план урока</h2><p class="muted">План не виден ученику целиком: это рабочая структура преподавателя.</p></div><button class="btn" id="mrPlanAuto">⚡ Из аналитики</button></div>
        <div class="field"><label>Главная цель урока</label><input id="mrPlanMainGoal" value="${esc(p.main_goal || '')}" placeholder="Что ученик должен уметь к концу занятия"></div>
        <div class="field"><label>Результаты урока — по одному на строку</label><textarea id="mrPlanObjectives" rows="4">${esc((Array.isArray(p.objectives) ? p.objectives : []).join('\n'))}</textarea></div>
        <div class="field"><label>Этапы урока</label><textarea id="mrPlanAgenda" rows="5" placeholder="10 | Разминка\n35 | Практика\n15 | Разбор ошибок">${esc(agendaToText(p.agenda))}</textarea><div class="small muted">Формат: минуты | этап. Во время урока этапы можно отмечать выполненными.</div></div>
        <div class="grid cols2"><div class="field"><label>Намерение по домашней</label><textarea id="mrPlanHomework" rows="3">${esc(p.homework_intent || '')}</textarea></div><div class="field"><label>Заметка преподавателя</label><textarea id="mrPlanTeacherNote" rows="3">${esc(p.teacher_note || '')}</textarea></div></div>
        <div class="field"><label>Связать с долгосрочными целями</label><div class="mr-goal-picker">${goals.length ? goals.map(g => `<label><input type="checkbox" data-plan-goal="${g.id}" ${selected.has(g.id) ? 'checked' : ''}> <span>${esc(g.title)}</span><small>${clampPct(g.progress)}%</small></label>`).join('') : '<div class="small muted">Активных целей пока нет — их можно добавить в профиле ученика.</div>'}</div></div>
        <div class="actions"><button class="btn primary" id="mrPlanSave">Сохранить план</button></div>`, 'wide-modal');
      m.querySelector('#mrPlanAuto').onclick = () => autoFillLessonPlan(ctx, m);
      m.querySelector('#mrPlanSave').onclick = async () => {
        try {
          const agenda = parseAgenda(m.querySelector('#mrPlanAgenda').value, p.agenda);
          const payload = {
            teacher_id: S.user.id,
            lesson_id: ctx.lessonId,
            student_id: ctx.studentId,
            main_goal: m.querySelector('#mrPlanMainGoal').value.trim(),
            objectives: m.querySelector('#mrPlanObjectives').value.split(/\n+/).map(x => x.trim()).filter(Boolean),
            agenda,
            homework_intent: m.querySelector('#mrPlanHomework').value.trim(),
            teacher_note: m.querySelector('#mrPlanTeacherNote').value.trim(),
            goal_ids: [...m.querySelectorAll('[data-plan-goal]:checked')].map(x => x.dataset.planGoal),
            updated_at: new Date().toISOString()
          };
          const { error } = await sb.from('lesson_plans').upsert(payload, { onConflict: 'lesson_id' });
          if (error) throw error;
          await appendLessonEvents(ctx, [{ kind: 'lesson_plan_updated', title: payload.main_goal || 'План урока обновлён', details: { agenda_items: agenda.length, goal_ids: payload.goal_ids } }]);
          m.remove(); await refreshTeacherAddon(ctx); toast('План урока сохранён');
        } catch (e) { fail(e); }
      };
    } catch (e) { fail(e); }
  }

  async function renderLessonPlanMount(ctx, host) {
    const mount = host.querySelector('#mrLessonPlanMount');
    if (!mount) return;
    let plan = null;
    try { plan = await getLessonPlan(ctx.lessonId); } catch (e) { console.warn('[Mathroom plan]', e); return; }
    if (!plan || (!plan.main_goal && !(plan.agenda || []).length)) {
      mount.innerHTML = `<div class="mr-plan-empty"><span>План урока ещё не заполнен.</span><button class="btn sm" id="mrPlanEmptyOpen">Создать план</button></div>`;
      mount.querySelector('#mrPlanEmptyOpen').onclick = () => openLessonPlan(ctx);
      return;
    }
    const agenda = Array.isArray(plan.agenda) ? plan.agenda : [];
    const done = agenda.filter(x => x.done).length;
    mount.innerHTML = `<div class="mr-plan-card"><div class="mr-card-head"><div><div class="small muted">Цель урока</div><b>${esc(plan.main_goal || 'План занятия')}</b></div><span class="pill">${done}/${agenda.length} этапов</span></div>${(plan.objectives || []).length ? `<div class="mr-plan-objectives">${plan.objectives.map(x => `<span>• ${esc(x)}</span>`).join('')}</div>` : ''}<div class="mr-agenda">${agenda.map((x, i) => `<label class="${x.done ? 'done' : ''}"><input type="checkbox" data-agenda-index="${i}" ${x.done ? 'checked' : ''}><span>${esc(x.title)}</span>${x.minutes ? `<small>${Number(x.minutes)} мин</small>` : ''}</label>`).join('')}</div></div>`;
    mount.querySelectorAll('[data-agenda-index]').forEach(ch => ch.onchange = async () => {
      const i = Number(ch.dataset.agendaIndex); const next = agenda.map((x, n) => n === i ? { ...x, done: ch.checked } : x);
      const { error } = await sb.from('lesson_plans').update({ agenda: next, updated_at: new Date().toISOString() }).eq('lesson_id', ctx.lessonId);
      if (error) return fail(error);
      await appendLessonEvents(ctx, [{ kind: 'lesson_plan_step', title: next[i]?.title || 'Этап урока', details: { done: ch.checked, index: i } }]);
      renderLessonPlanMount(ctx, host);
    });
  }

  function meanNum(arr = []) {
    const a = arr.map(Number).filter(Number.isFinite); return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
  }

  function aggregateReportCategories(reports = []) {
    const out = {};
    for (const r of reports) for (const [name, v] of Object.entries(r.category_stats || {})) {
      const a = out[name] ||= { solved: 0, hard: 0, later: 0, pending: 0 };
      for (const k of Object.keys(a)) a[k] += Number(v?.[k] || 0);
    }
    return Object.entries(out).map(([name, v]) => ({ name, ...v, attention: v.hard + v.later, reviewed: v.solved + v.hard + v.later, confidence: (v.solved + v.hard + v.later) ? Math.round(v.solved * 100 / (v.solved + v.hard + v.later)) : 0 }));
  }

  async function buildParentReport(studentId, days = 28) {
    const st = S.students.find(x => x.id === studentId);
    if (!st) throw new Error('Ученик не найден');
    const end = new Date(); const start = days ? new Date(end.getTime() - days * 86400000) : null;
    let rq = sb.from('lesson_reports').select('*').eq('student_id', studentId).order('created_at', { ascending: true });
    if (start) rq = rq.gte('created_at', start.toISOString());
    const [{ data: reports, error }, goals] = await Promise.all([rq, getStudentGoals(studentId, false)]);
    if (error) throw error;
    const rr = reports || [];
    const inPeriod = x => !start || new Date(x.submitted_at || x.created_at || 0) >= start;
    const hws = (S.homeworks || []).filter(x => x.student_id === studentId && inPeriod(x));
    const tests = (S.tests || []).filter(x => x.student_id === studentId && inPeriod(x));
    const confidence = meanNum(rr.map(x => x.solved_percent));
    const minutes = Math.round(rr.reduce((s, x) => s + Number(x.duration_seconds || 0), 0) / 60);
    const hwAvg = meanNum(hws.map(x => x.score)); const testAvg = meanNum(tests.map(x => x.score));
    const cats = aggregateReportCategories(rr);
    const strengths = cats.filter(x => x.reviewed >= 2 && x.solved > 0).sort((a,b) => b.confidence - a.confidence || b.solved - a.solved).slice(0,3).map(x => x.name);
    const focus = cats.filter(x => x.attention > 0).sort((a,b) => b.attention - a.attention || a.confidence - b.confidence).slice(0,3).map(x => x.name);
    const last = rr.at(-1);
    const period = start ? `${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')}` : `по ${end.toLocaleDateString('ru-RU')}`;
    const lines = [
      `Отчёт о прогрессе — ${st.name}, ${st.grade} класс`,
      `Период: ${period}`,
      '',
      `Занятия: ${rr.length}${minutes ? ` · ${minutes} мин суммарно` : ''}.`,
      confidence == null ? 'Уверенность по задачам: пока недостаточно данных.' : `Уверенно решённые задачи: в среднем ${confidence}%.`,
      hwAvg == null ? `Домашняя работа: ${hws.length ? 'есть работы без итоговой оценки.' : 'за период нет оценённых работ.'}` : `Домашняя работа: средний результат ${hwAvg}% (${hws.filter(x=>x.score!=null).length} оценённых).`,
      testAvg == null ? `Мини-тесты: ${tests.length ? 'есть тесты без итоговой оценки.' : 'за период нет оценённых тестов.'}` : `Мини-тесты: средний результат ${testAvg}% (${tests.filter(x=>x.score!=null).length} оценённых).`,
      '',
      strengths.length ? `Что получается увереннее: ${strengths.join(', ')}.` : 'Что получается увереннее: данных пока недостаточно для устойчивого вывода.',
      focus.length ? `Что сейчас требует внимания: ${focus.join(', ')}.` : 'Что требует внимания: выраженных сложных зон за период не отмечено.',
      goals.length ? `Текущие цели: ${goals.slice(0,4).map(g => `${g.title} — ${clampPct(g.progress)}%`).join('; ')}.` : 'Долгосрочные цели: пока не зафиксированы.',
      last?.public_focus ? `На ближайшее повторение: ${String(last.public_focus).replace(/^Повторить:\s*/i,'').trim()}` : '',
      '',
      'Следующий шаг: продолжить практику по отмеченным сложным зонам и закреплять результат на самостоятельных задачах.'
    ].filter((x, i, a) => x !== '' || (i && a[i-1] !== ''));
    return { student: st, reports: rr, goals, body: lines.join('\n'), period, days, metrics: { lessons: rr.length, minutes, confidence, homework_avg: hwAvg, test_avg: testAvg, strengths, focus } };
  }

  async function openParentReport(studentId, days = 28) {
    try {
      const built = await buildParentReport(studentId, days);
      const { data: saved } = await sb.from('parent_reports').select('id,title,period_start,period_end,created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(5);
      const m = modal(`<div class="mr-card-head"><div><h2>Отчёт родителю</h2><p class="muted">Фактическая сводка по занятиям, домашним, тестам и целям. Текст можно отредактировать перед отправкой.</p></div><select id="mrParentPeriod"><option value="28" ${days===28?'selected':''}>4 недели</option><option value="56" ${days===56?'selected':''}>8 недель</option><option value="90" ${days===90?'selected':''}>3 месяца</option><option value="0" ${days===0?'selected':''}>За всё время</option></select></div>
        <div class="mr-parent-metrics"><span>${built.metrics.lessons} занятий</span><span>${built.metrics.minutes} мин</span><span>${built.metrics.confidence ?? '—'}% уверенно</span><span>Д/З ${built.metrics.homework_avg ?? '—'}%</span><span>тесты ${built.metrics.test_avg ?? '—'}%</span></div>
        <div class="field"><label>Текст отчёта</label><textarea id="mrParentBody" rows="15">${esc(built.body)}</textarea></div>
        <div class="actions"><button class="btn primary" id="mrParentCopy">Копировать</button><button class="btn" id="mrParentSave">Сохранить снимок</button></div>
        ${saved?.length ? `<div class="hr"></div><h3>Последние сохранённые отчёты</h3><div class="mr-saved-parent-reports">${saved.map(x => `<div><b>${esc(x.title)}</b><span>${new Date(x.created_at).toLocaleDateString('ru-RU')}</span></div>`).join('')}</div>` : ''}`, 'wide-modal');
      m.querySelector('#mrParentPeriod').onchange = () => { const d = Number(m.querySelector('#mrParentPeriod').value); m.remove(); openParentReport(studentId, d); };
      m.querySelector('#mrParentCopy').onclick = async () => { await copyText(m.querySelector('#mrParentBody').value); toast('Отчёт скопирован'); };
      m.querySelector('#mrParentSave').onclick = async () => {
        const end = new Date(); const start = built.days ? new Date(end.getTime() - built.days * 86400000) : null;
        const { error } = await sb.from('parent_reports').insert({ teacher_id: S.user.id, student_id: studentId, period_start: start ? start.toISOString().slice(0,10) : null, period_end: end.toISOString().slice(0,10), title: `Отчёт родителю · ${built.period}`, body: m.querySelector('#mrParentBody').value, metrics: built.metrics });
        if (error) return fail(error); toast('Снимок отчёта сохранён');
      };
    } catch (e) { fail(e); }
  }

  async function openLessonParentReport(lessonId) {
    try {
      const lesson = (S.lessons || []).find(x => x.id === lessonId);
      if (!lesson) return toast('Урок не найден');
      const { data: r, error } = await sb.from('lesson_reports').select('*').eq('lesson_id', lessonId).maybeSingle();
      if (error) throw error;
      const st = S.students.find(x => x.id === lesson.student_id);
      const body = [
        `Итоги занятия — ${st?.name || 'ученик'}`,
        `${lesson.topics?.title || 'Урок'} · ${new Date(lesson.completed_at || lesson.started_at || lesson.created_at).toLocaleDateString('ru-RU')}`,
        '',
        r ? `Задачи: ${r.solved_count}/${r.queue_total} решено уверенно; ${r.hard_count} отмечено сложными; ${r.later_count} оставлено на повторение.` : '',
        r?.public_highlights ? `Что получилось: ${r.public_highlights}` : '',
        r?.public_focus ? `Что повторить: ${r.public_focus}` : '',
        lesson.homework_plan ? `К следующему уроку: ${lesson.homework_plan}` : ''
      ].filter(Boolean).join('\n');
      const m = modal(`<h2>Отчёт родителю за урок</h2><div class="field"><textarea id="mrLessonParentBody" rows="11">${esc(body)}</textarea></div><button class="btn primary" id="mrLessonParentCopy">Копировать</button>`);
      m.querySelector('#mrLessonParentCopy').onclick = async () => { await copyText(m.querySelector('#mrLessonParentBody').value); toast('Отчёт скопирован'); };
    } catch (e) { fail(e); }
  }


  // ---- Cumulative WIP: smart between-lesson preparation + spaced review ----
  const isoDay = d => new Date(d).toISOString().slice(0, 10);
  const todayDay = () => isoDay(new Date());
  const dayStart = value => new Date(`${String(value).slice(0,10)}T00:00:00`);
  const addDays = (value, days) => { const d = new Date(value); d.setDate(d.getDate() + days); return d; };
  const effectiveReviewDate = item => item?.manual_next_review_at || item?.next_review_at || todayDay();

  function reviewDueLabel(item) {
    if (!item?.next_review_at) return 'без даты';
    const due = dayStart(effectiveReviewDate(item)).getTime(), now = dayStart(todayDay()).getTime();
    const delta = Math.round((due - now) / 86400000);
    if (delta < 0) return `просрочено на ${Math.abs(delta)} дн.`;
    if (delta === 0) return 'повторить сегодня';
    if (delta === 1) return 'повторить завтра';
    return `через ${delta} дн.`;
  }

  function reviewPriority(item) {
    const due = dayStart(effectiveReviewDate(item)).getTime();
    const days = Math.floor((due - dayStart(todayDay()).getTime()) / 86400000);
    return (days <= 0 ? 100 : Math.max(0, 30 - days * 4)) + (100 - Number(item.mastery || 0)) + Number(item.priority || 0);
  }

  async function rebuildReviewQueue(studentId) {
    const reportsReq = sb.from('lesson_reports').select('category_stats,tag_stats,created_at').eq('student_id', studentId).order('created_at', { ascending: true });
    const reportsRes = await reportsReq;
    if (reportsRes.error) throw reportsRes.error;
    const homeworks = (S.homeworks || []).filter(x => x.student_id === studentId && (['submitted','reviewed'].includes(x.status) || Number(x.attempt_count || 0) > 0));
    const tests = (S.tests || []).filter(x => x.student_id === studentId && x.status === 'submitted');
    const hwIds = homeworks.map(x => x.id), testIds = tests.map(x => x.id);
    const [hwItemsRes, testItemsRes] = await Promise.all([
      hwIds.length ? sb.from('homework_items').select('homework_id,is_correct,category,tags').in('homework_id', hwIds) : Promise.resolve({ data: [], error: null }),
      testIds.length ? sb.from('test_items').select('test_id,is_correct,category,tags').in('test_id', testIds) : Promise.resolve({ data: [], error: null })
    ]);
    if (hwItemsRes.error) throw hwItemsRes.error; if (testItemsRes.error) throw testItemsRes.error;

    const signals = new Map();
    const push = (kind, label, quality, when, source, weight = 1) => {
      label = String(label || '').trim(); if (!label || !Number.isFinite(Number(quality))) return;
      const key = `${kind}\u0000${label}`; if (!signals.has(key)) signals.set(key, []);
      signals.get(key).push({ quality: Math.max(0, Math.min(1, Number(quality))), when: when || new Date().toISOString(), source, weight: Math.max(1, Number(weight || 1)) });
    };
    const fromStats = (kind, stats, when) => {
      for (const [label, v] of Object.entries(stats || {})) {
        const reviewed = Number(v.solved || 0) + Number(v.hard || 0) + Number(v.later || 0);
        if (!reviewed) continue;
        push(kind, label, Number(v.solved || 0) / reviewed, when, 'lesson', reviewed);
      }
    };
    for (const r of reportsRes.data || []) { fromStats('category', r.category_stats, r.created_at); fromStats('tag', r.tag_stats, r.created_at); }
    const hwById = new Map(homeworks.map(x => [x.id, x]));
    for (const x of hwItemsRes.data || []) if (x.is_correct !== null) {
      const parent = hwById.get(x.homework_id); const when = parent?.submitted_at || parent?.created_at || new Date().toISOString(); const q = x.is_correct ? 1 : 0;
      push('category', x.category, q, when, 'homework'); for (const t of x.tags || []) push('tag', t, q, when, 'homework');
    }
    const testById = new Map(tests.map(x => [x.id, x]));
    for (const x of testItemsRes.data || []) if (x.is_correct !== null) {
      const parent = testById.get(x.test_id); const when = parent?.submitted_at || parent?.created_at || new Date().toISOString(); const q = x.is_correct ? 1 : 0;
      push('category', x.category, q, when, 'test'); for (const t of x.tags || []) push('tag', t, q, when, 'test');
    }

    const rows = [];
    for (const [key, arr0] of signals) {
      const [kind, label] = key.split('\u0000'); const arr = [...arr0].sort((a,b) => new Date(a.when) - new Date(b.when)); const recent = arr.slice(-12);
      let weighted = 0, weight = 0; recent.forEach((x, i) => { const recency = 1 + i / Math.max(1, recent.length - 1); const w = x.weight * recency; weighted += x.quality * w; weight += w; });
      const mastery = Math.max(0, Math.min(100, Math.round((weight ? weighted / weight : .5) * 100)));
      let streak = 0; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].quality >= .8) streak++; else break; }
      const last = arr.at(-1); let interval = 1;
      if (last.quality >= .8) interval = streak >= 4 ? 45 : streak === 3 ? 30 : streak === 2 ? 14 : 7;
      else if (last.quality >= .6) interval = 3;
      const next = addDays(last.when, interval);
      rows.push({ teacher_id: S.user.id, student_id: studentId, kind, label, mastery, streak, evidence_count: arr.length, next_review_at: isoDay(next), last_seen_at: new Date(last.when).toISOString(), last_result: Math.round(last.quality * 100), last_source: last.source, updated_at: new Date().toISOString() });
    }
    if (rows.length) { const { error } = await sb.from('student_review_items').upsert(rows, { onConflict: 'student_id,kind,label' }); if (error) throw error; }
    const { data: fresh, error: freshError } = await sb.from('student_review_items').select('*').eq('student_id', studentId).eq('is_archived', false); if (freshError) throw freshError;
    return (fresh || []).sort((a,b) => reviewPriority(b) - reviewPriority(a));
  }

  async function getReviewQueue(studentId, rebuild = false) {
    if (rebuild) return rebuildReviewQueue(studentId);
    const { data, error } = await sb.from('student_review_items').select('*').eq('student_id', studentId).eq('is_archived', false);
    if (error) throw error;
    return (data || []).sort((a,b) => reviewPriority(b) - reviewPriority(a));
  }

  async function recommendedExercisesForReview(studentId, reviewItems, limit = 8) {
    const due = [...(reviewItems || [])].sort((a,b) => reviewPriority(b) - reviewPriority(a)).slice(0, 12);
    const cats = new Map(due.filter(x => x.kind === 'category').map(x => [x.label, x]));
    const tags = new Map(due.filter(x => x.kind === 'tag').map(x => [x.label, x]));
    const assigned = (S.homeworks || []).filter(x => x.student_id === studentId && x.status === 'assigned').map(x => x.id);
    let used = new Set();
    if (assigned.length) {
      const { data } = await sb.from('homework_items').select('source_exercise_id').in('homework_id', assigned);
      used = new Set((data || []).map(x => x.source_exercise_id).filter(Boolean));
    }
    const st = (S.students || []).find(x => x.id === studentId);
    return (S.exercises || []).filter(x => x.kind === 'task' && String(x.answer || '').trim() && !used.has(x.id)).map(x => {
      let score = 0;
      if (cats.has(x.category)) score += 80 + (100 - Number(cats.get(x.category).mastery || 0));
      for (const t of x.tags || []) if (tags.has(t)) score += 45 + (100 - Number(tags.get(t).mastery || 0)) / 2;
      const topic = (S.topics || []).find(t => t.id === x.topic_id); if (topic && st && Number(topic.grade) === Number(st.grade)) score += 8;
      score -= Math.min(15, Number(x.use_count || 0));
      return { ...x, _smartScore: score };
    }).filter(x => x._smartScore > 0).sort((a,b) => b._smartScore - a._smartScore || Number(a.use_count || 0) - Number(b.use_count || 0)).slice(0, limit);
  }

  function defaultHomeworkDue(studentId) {
    const next = (S.lessons || []).filter(x => x.student_id === studentId && x.status === 'assigned' && x.scheduled_at && new Date(x.scheduled_at) > new Date()).sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
    const d = next ? new Date(new Date(next.scheduled_at).getTime() - 12 * 3600000) : addDays(new Date(), 3);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function openSmartHomework(studentId) {
    try {
      const review = await getReviewQueue(studentId, true); const tasks = await recommendedExercisesForReview(studentId, review, 10); const st = (S.students || []).find(x => x.id === studentId);
      if (!tasks.length) return toast('Пока нет подходящих задач для умного ДЗ');
      const selected = new Set(tasks.slice(0, Math.min(6, tasks.length)).map(x => x.id));
      const m = modal(`<div class="mr-card-head"><div><h2>Умное ДЗ · ${esc(st?.name || 'ученик')}</h2><p class="muted">Подборка строится из сложных мест на уроках, домашних и тестах.</p></div><span class="pill">${review.filter(x => effectiveReviewDate(x) <= todayDay()).length} на повторение</span></div>
        <div class="grid cols2"><div class="field"><label>Название</label><input id="mrSmartHwTitle" value="Умное ДЗ · повторение"></div><div class="field"><label>Срок</label><input id="mrSmartHwDue" type="datetime-local" value="${defaultHomeworkDue(studentId)}"></div></div>
        <div class="mr-smart-task-list">${tasks.map((x,i) => `<label class="mr-smart-task"><input type="checkbox" data-smart-task="${x.id}" ${selected.has(x.id)?'checked':''}><span><b>${esc(x.title || 'Задача')}</b><small>${esc(x.category || '')}${(x.tags||[]).length ? ` · ${(x.tags||[]).map(t=>'#'+esc(t)).join(' ')}` : ''}</small><em>${esc(String(x.content || '').replace(/\s+/g,' ').slice(0,180))}</em></span><span class="pill">${esc(MR.diffLabel ? MR.diffLabel(x.difficulty) : x.difficulty)}</span></label>`).join('')}</div>
        <div class="actions"><button class="btn primary" id="mrSmartHwCreate">Назначить выбранные</button><span class="small muted" id="mrSmartHwCount"></span></div>`, 'wide-modal');
      const update = () => { selected.clear(); m.querySelectorAll('[data-smart-task]:checked').forEach(x => selected.add(x.dataset.smartTask)); m.querySelector('#mrSmartHwCount').textContent = `${selected.size} задач`; };
      m.querySelectorAll('[data-smart-task]').forEach(x => x.onchange = update); update();
      m.querySelector('#mrSmartHwCreate').onclick = async () => {
        try {
          if (!selected.size) return toast('Выбери хотя бы одну задачу');
          const chosen = tasks.filter(x => selected.has(x.id)); const dueVal = m.querySelector('#mrSmartHwDue').value;
          const body = { teacher_id: S.user.id, student_id: studentId, topic_id: chosen[0]?.topic_id || null, title: m.querySelector('#mrSmartHwTitle').value.trim() || 'Умное ДЗ · повторение', due_at: dueVal ? new Date(dueVal).toISOString() : null, source: 'smart_review', smart_meta: { generated_at: new Date().toISOString(), review_labels: review.slice(0,8).map(x => ({ kind:x.kind, label:x.label, mastery:x.mastery, due:effectiveReviewDate(x) })) } };
          const { data: hw, error } = await sb.from('homeworks').insert(body).select().single(); if (error) throw error;
          const rows = chosen.map((x,i) => ({ homework_id: hw.id, prompt: x.content, correct_answer: x.answer, position: i, source_exercise_id: x.id, difficulty: x.difficulty, category: x.category || '', tags: x.tags || [] }));
          const { error: itemError } = await sb.from('homework_items').insert(rows); if (itemError) throw itemError;
          S.homeworks = [{ ...hw, students: { name: st?.name || '' }, topics: { title: (S.topics||[]).find(t=>t.id===hw.topic_id)?.title || 'Повторение' } }, ...(S.homeworks || [])];
          m.remove(); document.querySelector('#mrSmartPrep')?.remove(); await enhanceSmartPreparation(); toast(`Назначено умное ДЗ: ${chosen.length} задач`);
        } catch (e) { fail(e); }
      };
    } catch (e) { fail(e); }
  }

  async function buildNextLessonDraft(studentId) {
    const next = (S.lessons || []).filter(x => x.student_id === studentId && x.status === 'assigned' && x.scheduled_at && new Date(x.scheduled_at) > new Date()).sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
    if (!next) return { next: null };
    const [review, goals, latestReports, masteryRows] = await Promise.all([
      getReviewQueue(studentId, true), getStudentGoals(studentId, false), sb.from('lesson_reports').select('public_focus,public_highlights,created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1).then(x => x.error ? Promise.reject(x.error) : x.data || []), getTopicMastery(studentId, true)
    ]);
    const due = review.filter(x => effectiveReviewDate(x) <= isoDay(next.scheduled_at)).sort((a,b) => reviewPriority(b)-reviewPriority(a));
    const weakTopics = (masteryRows || []).filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery)).slice(0,3);
    const top = due.slice(0,4).map(x => x.label); const topic = (S.topics || []).find(x => x.id === next.topic_id); const last = latestReports[0];
    const weakestTitle = weakTopics[0]?.topics?.title || '';
    const main = top.length ? `Закрепить ${top.slice(0,2).join(' и ')} и продолжить тему «${topic?.title || 'урока'}»` : weakestTitle && weakestTitle!==topic?.title ? `Закрепить «${weakestTitle}» и продолжить тему «${topic?.title || 'урока'}»` : `Продолжить тему «${topic?.title || 'урока'}»`;
    const objectives = [...new Set([top.length ? `Повторить: ${top.join(', ')}` : '', weakTopics.length ? `Вернуться к слабым темам курса: ${weakTopics.map(x=>x.topics?.title).filter(Boolean).join(', ')}` : '', last?.public_focus ? String(last.public_focus).replace(/^Повторить:\s*/i,'').trim() : '', `Отработать самостоятельные задачи по теме «${topic?.title || 'урока'}»`].filter(Boolean))];
    const agenda = [
      { title:'Короткое повторение по расписанию', minutes:10, done:false, position:0 },
      { title:'Разбор ключевого материала', minutes:15, done:false, position:1 },
      { title:'Основная практика', minutes:25, done:false, position:2 },
      { title:'Самостоятельная задача', minutes:7, done:false, position:3 },
      { title:'Итоги и домашняя работа', minutes:3, done:false, position:4 }
    ];
    const payload = { teacher_id:S.user.id, lesson_id:next.id, student_id:studentId, main_goal:main, objectives, agenda, homework_intent: top.length ? `Закрепить: ${top.slice(0,3).join(', ')}` : '', teacher_note: `Авточерновик Mathroom. Проверить перед уроком.${last?.public_highlights ? ` Последний успех: ${last.public_highlights}` : ''}`, goal_ids: goals.slice(0,3).map(x=>x.id), updated_at:new Date().toISOString() };
    const { error } = await sb.from('lesson_plans').upsert(payload, { onConflict:'lesson_id' }); if (error) throw error;
    const tasks = await recommendedExercisesForReview(studentId, due.length ? due : review, 5);
    return { next, review: due, tasks, payload };
  }

  async function openNextLessonDraft(studentId) {
    try {
      const d = await buildNextLessonDraft(studentId); if (!d.next) return toast('Сначала запланируй следующий урок');
      const st = (S.students || []).find(x => x.id === studentId); const topic = (S.topics || []).find(x => x.id === d.next.topic_id);
      const m = modal(`<h2>Черновик следующего урока готов</h2><p class="muted">${esc(st?.name || '')} · ${esc(topic?.title || 'Без темы')} · ${new Date(d.next.scheduled_at).toLocaleString('ru-RU')}</p>
        <div class="notice"><b>${esc(d.payload.main_goal)}</b><br>${d.payload.objectives.map(x=>'• '+esc(x)).join('<br>')}</div>
        <div class="mr-review-mini">${d.review.length ? d.review.slice(0,6).map(x=>`<span class="pill ${Number(x.mastery)<60?'warn':''}">${x.kind==='tag'?'#':''}${esc(x.label)} · ${x.mastery}%</span>`).join('') : '<span class="small muted">Просроченного повторения нет.</span>'}</div>
        <div class="actions"><button class="btn primary" id="mrDraftQueue">Добавить ${Math.min(3,d.tasks.length)} задачи повторения в очередь</button><button class="btn" id="mrDraftClose">Готово</button></div>`);
      m.querySelector('#mrDraftClose').onclick = () => m.remove();
      m.querySelector('#mrDraftQueue').onclick = async () => {
        try { const chosen = d.tasks.slice(0,3); if (!chosen.length) return toast('Нет подходящих задач'); await applyExercisesToQueue({ role:'teacher', lessonId:d.next.id, studentId, lesson:d.next }, chosen.map(x=>x.id)); m.remove(); toast('План и задачи для следующего урока готовы'); } catch (e) { fail(e); }
      };
    } catch (e) { fail(e); }
  }

  async function openReviewPlanner(studentId) {
    try {
      let items = await getReviewQueue(studentId, false);
      if (!items.length) items = await getReviewQueue(studentId, true);

      const backdrop = modal(`<div id="mrReviewPlannerBody"></div>`, 'wide-modal');
      const body = backdrop.querySelector('#mrReviewPlannerBody');
      let busy = false;

      const loadFresh = async (rebuild=false) => {
        items = await getReviewQueue(studentId, rebuild);
      };

      const render = () => {
        if (!document.body.contains(backdrop) || !body) return;
        const today = todayDay();
        const due = items.filter(x => effectiveReviewDate(x) <= today);
        const upcoming = items.filter(x => effectiveReviewDate(x) > today);
        const row = x => `<div class="mr-review-row" data-review-id="${x.id}">
          <div><b>${x.kind==='tag'?'#':''}${esc(x.label)}</b><small>${x.kind==='category'?'категория':'тег'} · ${x.evidence_count} наблюд. · последнее ${Math.round(Number(x.last_result || 0))}%${x.priority?` · приоритет +${x.priority}`:''}</small>${x.teacher_note?`<em>${esc(x.teacher_note)}</em>`:''}</div>
          <div class="mr-review-mastery"><span>${x.mastery}%</span><div class="mr-goal-progress"><i style="width:${clampPct(x.mastery)}%"></i></div></div>
          <div class="mr-review-due"><span class="pill ${effectiveReviewDate(x)<=today?'warn':''}">${esc(reviewDueLabel(x))}</span><div class="actions"><button class="btn xs" data-review-today="${x.id}">Сегодня</button><button class="btn xs" data-review-week="${x.id}">+7</button><button class="btn xs ${x.priority?'primary':''}" data-review-priority="${x.id}">★</button><button class="btn xs" data-review-hide="${x.id}">Скрыть</button></div></div>
        </div>`;
        body.innerHTML = `<div class="mr-card-head"><div><h2>План повторения</h2><p class="muted">Автоинтервалы можно вручную скорректировать. Пересчёт запускается только по кнопке и больше не блокирует профиль.</p></div><div class="actions"><span class="pill">${due.length} нужно повторить</span><button class="btn sm" id="mrReviewRebuild">Пересчитать</button></div></div>
          <div class="notice"><b>Как читать:</b> Mathroom считает освоение по урокам, ДЗ и тестам. «Сегодня» возвращает тему в ближайшее повторение, «+7» откладывает, ★ повышает приоритет.</div>
          <h3>Сейчас</h3><div class="mr-review-list">${due.length?due.sort((a,b)=>reviewPriority(b)-reviewPriority(a)).map(row).join(''):'<div class="empty">На сегодня ничего не просрочено.</div>'}</div>
          <div class="hr"></div><h3>Дальше</h3><div class="mr-review-list">${upcoming.length?upcoming.slice(0,16).map(row).join(''):'<div class="empty">Следующие интервалы появятся после новых результатов.</div>'}</div>`;
        bind();
      };

      const update = async (id, patch, msg) => {
        if (busy) return;
        busy = true;
        try {
          const { error } = await sb.from('student_review_items').update({...patch,updated_at:new Date().toISOString()}).eq('id',id);
          if (error) throw error;
          await loadFresh(false);
          render();
          toast(msg);
        } finally { busy = false; }
      };

      const bind = () => {
        body.querySelector('#mrReviewRebuild')?.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          const btn = body.querySelector('#mrReviewRebuild');
          if (btn) { btn.disabled = true; btn.textContent = 'Считаем…'; }
          try {
            await loadFresh(true);
            render();
            toast('План повторения пересчитан');
          } catch (e) { fail(e); }
          finally { busy = false; }
        });
        body.querySelectorAll('[data-review-today]').forEach(b=>b.onclick=()=>update(b.dataset.reviewToday,{manual_next_review_at:todayDay(),is_archived:false},'Поставлено на сегодня').catch(fail));
        body.querySelectorAll('[data-review-week]').forEach(b=>b.onclick=()=>update(b.dataset.reviewWeek,{manual_next_review_at:isoDay(addDays(new Date(),7)),is_archived:false},'Повторение отложено на 7 дней').catch(fail));
        body.querySelectorAll('[data-review-priority]').forEach(b=>b.onclick=()=>{const on=b.classList.contains('primary');update(b.dataset.reviewPriority,{priority:on?0:40},on?'Приоритет снят':'Приоритет повышен').catch(fail)});
        body.querySelectorAll('[data-review-hide]').forEach(b=>b.onclick=()=>update(b.dataset.reviewHide,{is_archived:true},'Тема скрыта из плана').catch(fail));
      };

      render();
    } catch (e) { fail(e); }
  }

  async function enhanceSmartPreparation() {
    if (S.access || S.view !== 'profile' || !S.selectedStudent || document.querySelector('#mrSmartPrep')) return;
    const content = document.querySelector('.content'); if (!content) return;
    try {
      let review = await getReviewQueue(S.selectedStudent, false);
      if (!review.length) review = await getReviewQueue(S.selectedStudent, true);
      if (S.view !== 'profile' || document.querySelector('#mrSmartPrep')) return;
      const today = todayDay(), due = review.filter(x => effectiveReviewDate(x) <= today).sort((a,b)=>reviewPriority(b)-reviewPriority(a));
      const assigned = (S.homeworks || []).filter(x => x.student_id === S.selectedStudent && x.status === 'assigned'); const submitted = (S.homeworks || []).filter(x => x.student_id === S.selectedStudent && x.status === 'submitted');
      const next = (S.lessons || []).filter(x=>x.student_id===S.selectedStudent&&x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at)>new Date()).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0];
      const box = document.createElement('div'); box.id='mrSmartPrep'; box.className='card mr-smart-prep';
      box.innerHTML = `<div class="mr-card-head"><div><h2>Подготовка между уроками</h2><p class="small muted">Повторение, умное ДЗ и черновик следующего занятия.</p></div><div class="actions"><button class="btn sm" id="mrReviewPlan">План повторения</button><button class="btn sm" id="mrNextDraft">Черновик урока</button><button class="btn sm primary" id="mrSmartHomework">⚡ Собрать ДЗ</button></div></div>
        <div class="mr-smart-metrics"><span><b>${due.length}</b><small>повторить сейчас</small></span><span><b>${review.filter(x=>Number(x.mastery)<60).length}</b><small>слабых зон</small></span><span><b>${assigned.length}</b><small>ДЗ выполняется</small></span><span><b>${submitted.length}</b><small>на проверке</small></span></div>
        ${due.length ? `<div class="mr-review-mini">${due.slice(0,8).map(x=>`<span class="pill ${Number(x.mastery)<60?'warn':''}">${x.kind==='tag'?'#':''}${esc(x.label)} · ${x.mastery}%</span>`).join('')}</div>` : '<div class="small muted">По текущим данным срочного повторения нет.</div>'}
        <div class="small muted" style="margin-top:8px">${next ? `Следующий урок: ${new Date(next.scheduled_at).toLocaleString('ru-RU')}` : 'Следующий урок пока не запланирован.'}</div>`;
      const anchor = document.querySelector('#mrGoalsOverview') || content.querySelector('.profile-metrics') || content.firstElementChild; anchor?.insertAdjacentElement('afterend', box);
      box.querySelector('#mrSmartHomework').onclick = () => openSmartHomework(S.selectedStudent);
      box.querySelector('#mrNextDraft').onclick = () => openNextLessonDraft(S.selectedStudent);
      box.querySelector('#mrReviewPlan').onclick = () => openReviewPlanner(S.selectedStudent);
    } catch (e) { console.warn('[Mathroom smart prep]', e); }
  }

  async function enhanceDashboardHomeworkWatch() {
    if (S.access || S.view !== 'dashboard' || document.querySelector('#mrHomeworkWatch')) return;
    const content = document.querySelector('.content'); if (!content) return;
    const now = Date.now(), soon = now + 48 * 3600000;
    const overdue = (S.homeworks || []).filter(x => x.status === 'assigned' && x.due_at && new Date(x.due_at).getTime() < now);
    const dueSoon = (S.homeworks || []).filter(x => x.status === 'assigned' && x.due_at && new Date(x.due_at).getTime() >= now && new Date(x.due_at).getTime() <= soon);
    const submitted = (S.homeworks || []).filter(x => x.status === 'submitted');
    const revision = (S.homeworks || []).filter(x => x.status === 'assigned' && x.revision_requested_at);
    if (!overdue.length && !dueSoon.length && !submitted.length && !revision.length) return;
    const stName = id => (S.students || []).find(x=>x.id===id)?.name || 'Ученик';
    const rows = [...submitted.map(x=>({...x,_kind:'На проверке'})), ...revision.map(x=>({...x,_kind:'Доработка'})), ...overdue.map(x=>({...x,_kind:'Просрочено'})), ...dueSoon.map(x=>({...x,_kind:'Срок скоро'}))].slice(0,8);
    const box = document.createElement('div'); box.id='mrHomeworkWatch'; box.className='card mr-homework-watch';
    box.innerHTML=`<div class="mr-card-head"><div><h2>Контроль домашних</h2><p class="small muted">${submitted.length} на проверке · ${revision.length} доработка · ${overdue.length} просрочено · ${dueSoon.length} скоро срок</p></div><button class="btn sm" id="mrOpenAssignments">Открыть задания</button></div><div class="mr-homework-watch-list">${rows.map(x=>`<div><span class="pill ${x._kind==='Просрочено'?'warn':''}">${x._kind}</span><b>${esc(stName(x.student_id))}</b><span>${esc(x.title)}</span><small>${x.due_at?new Date(x.due_at).toLocaleString('ru-RU'):''}</small></div>`).join('')}</div>`;
    const grid=content.querySelector('.grid.cols4'); if(grid) grid.insertAdjacentElement('afterend',box); else content.prepend(box);
    box.querySelector('#mrOpenAssignments').onclick=()=>document.querySelector('[data-nav="assignments"]')?.click();
  }

  async function enhanceStudentReview() {
    if (!S.access || S.studentTab !== 'progress' || !S.student || document.querySelector('#mrStudentReview')) return;
    const content=document.querySelector('#studentContent'); if(!content) return;
    try {
      const { data, error } = await sb.rpc('get_my_review_items'); if(error) throw error; const items=Array.isArray(data)?data:[]; const today=todayDay(); const due=items.filter(x=>x.next_review_at<=today).slice(0,8), upcoming=items.filter(x=>x.next_review_at>today).slice(0,5);
      const box=document.createElement('div'); box.id='mrStudentReview'; box.className='card mr-student-review';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Повторение</h2><p class="small muted">Темы, которые полезно освежить по результатам последних занятий.</p></div><span class="pill">${due.length} сейчас</span></div>${due.length?`<div class="mr-review-mini">${due.map(x=>`<span class="pill ${Number(x.mastery)<60?'warn':''}">${x.kind==='tag'?'#':''}${esc(x.label)} · ${x.mastery}%</span>`).join('')}</div>`:'<div class="notice">На сегодня срочного повторения нет.</div>'}${upcoming.length?`<div class="small muted" style="margin-top:10px">Дальше: ${upcoming.map(x=>`${x.kind==='tag'?'#':''}${esc(x.label)} — ${new Date(x.next_review_at+'T00:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`).join(' · ')}</div>`:''}`;
      const goals=document.querySelector('#mrStudentGoals'); if(goals) goals.insertAdjacentElement('afterend',box); else content.prepend(box);
    } catch(e){ console.warn('[Mathroom student review]',e); }
  }


  // ---- Cumulative WIP: student activity journal + course mastery map ----
  const meanSafe = values => {
    const xs = (values || []).map(Number).filter(Number.isFinite);
    return xs.length ? Math.round(xs.reduce((a,b)=>a+b,0) / xs.length) : null;
  };

  function masteryStatus(score, evidence = 0) {
    if (!evidence || score == null || !Number.isFinite(Number(score))) return { key:'no_data', label:'Нет данных' };
    const n = Number(score);
    if (n >= 85) return { key:'mastered', label:'Освоено' };
    if (n >= 70) return { key:'confident', label:'Уверенно' };
    if (n >= 50) return { key:'working', label:'В работе' };
    return { key:'attention', label:'Требует внимания' };
  }

  function activityWhen(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch { return ''; }
  }

  async function rebuildTopicMastery(studentId) {
    const st = (S.students || []).find(x => x.id === studentId);
    if (!st) return [];
    const referenced = new Set([
      ...(S.lessons || []).filter(x=>x.student_id===studentId).map(x=>x.topic_id),
      ...(S.homeworks || []).filter(x=>x.student_id===studentId).map(x=>x.topic_id),
      ...(S.tests || []).filter(x=>x.student_id===studentId).map(x=>x.topic_id)
    ].filter(Boolean));
    const topics = (S.topics || []).filter(t => Number(t.grade) === Number(st.grade) || referenced.has(t.id));
    if (!topics.length) return [];
    const [reportsRes, reviewRes] = await Promise.all([
      sb.from('lesson_reports').select('topic_id,solved_percent,queue_total,created_at').eq('student_id', studentId).order('created_at',{ascending:true}),
      sb.from('student_review_items').select('kind,label,mastery,evidence_count,last_seen_at,is_archived').eq('student_id',studentId).eq('is_archived',false)
    ]);
    if (reportsRes.error) throw reportsRes.error;
    if (reviewRes.error) throw reviewRes.error;
    const reports = reportsRes.data || [], review = reviewRes.data || [];
    const hws = (S.homeworks || []).filter(x => x.student_id === studentId && ['submitted','reviewed'].includes(x.status) && x.score != null);
    const tests = (S.tests || []).filter(x => x.student_id === studentId && x.status === 'submitted' && x.score != null);
    const exByTopic = new Map();
    for (const e of (S.exercises || [])) {
      if (!e.topic_id) continue;
      const a = exByTopic.get(e.topic_id) || { categories:new Set(), tags:new Set() };
      if (e.category) a.categories.add(String(e.category));
      for (const t of (e.tags || [])) if (t) a.tags.add(String(t));
      exByTopic.set(e.topic_id, a);
    }
    const now = new Date().toISOString();
    const rows = topics.map(topic => {
      const rs = reports.filter(r=>r.topic_id===topic.id);
      const hs = hws.filter(h=>h.topic_id===topic.id);
      const ts = tests.filter(t=>t.topic_id===topic.id);
      const vocabulary = exByTopic.get(topic.id) || { categories:new Set(), tags:new Set() };
      const rv = review.filter(r => (r.kind==='category' && vocabulary.categories.has(String(r.label))) || (r.kind==='tag' && vocabulary.tags.has(String(r.label))));
      const lessonScore = meanSafe(rs.map(r=>r.solved_percent));
      const homeworkScore = meanSafe(hs.map(h=>h.score));
      const testScore = meanSafe(ts.map(t=>t.score));
      const reviewScore = meanSafe(rv.map(r=>r.mastery));
      const components = [
        [lessonScore,3], [homeworkScore,2], [testScore,2.5], [reviewScore,1]
      ].filter(([v])=>v!=null && Number.isFinite(Number(v)));
      const weight = components.reduce((s,[,w])=>s+w,0);
      const mastery = weight ? Math.round(components.reduce((s,[v,w])=>s+Number(v)*w,0)/weight) : null;
      const evidence = rs.length + hs.length + ts.length + rv.reduce((s,r)=>s+Math.max(1,Number(r.evidence_count||0)),0);
      const recent = rs.slice(-2).map(r=>Number(r.solved_percent||0));
      const previous = rs.slice(-4,-2).map(r=>Number(r.solved_percent||0));
      const trend = recent.length && previous.length ? meanSafe(recent) - meanSafe(previous) : null;
      const times = [
        ...rs.map(x=>x.created_at),
        ...hs.map(x=>x.reviewed_at||x.submitted_at||x.created_at),
        ...ts.map(x=>x.submitted_at||x.created_at),
        ...rv.map(x=>x.last_seen_at)
      ].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
      const lastActivity = times.length ? new Date(Math.max(...times)).toISOString() : null;
      const status = masteryStatus(mastery,evidence);
      return {
        teacher_id:S.user.id, student_id:studentId, topic_id:topic.id,
        mastery, status:status.key, evidence_count:evidence,
        lesson_score:lessonScore, homework_score:homeworkScore, test_score:testScore, review_score:reviewScore,
        trend, last_activity_at:lastActivity, updated_at:now,
        details:{ lessons:rs.length, homeworks:hs.length, tests:ts.length, review_signals:rv.length }
      };
    });
    const { error } = await sb.from('student_topic_mastery').upsert(rows,{onConflict:'student_id,topic_id'});
    if (error) throw error;
    const { data, error:readError } = await sb.from('student_topic_mastery').select('*,topics(title,section,grade)').eq('student_id',studentId);
    if (readError) throw readError;
    return (data || []).sort((a,b)=>Number(a.topics?.grade||0)-Number(b.topics?.grade||0)||String(a.topics?.section||'').localeCompare(String(b.topics?.section||''),'ru')||String(a.topics?.title||'').localeCompare(String(b.topics?.title||''),'ru'));
  }

  async function getTopicMastery(studentId, rebuild = true) {
    if (rebuild) return rebuildTopicMastery(studentId);
    const { data, error } = await sb.from('student_topic_mastery').select('*,topics(title,section,grade)').eq('student_id',studentId);
    if (error) throw error;
    return data || [];
  }

  function masteryTile(row, compact = false) {
    const s = masteryStatus(row.mastery,row.evidence_count);
    const score = row.mastery == null ? '—' : `${Math.round(Number(row.mastery))}%`;
    const trend = row.trend == null ? '' : `<span class="mr-mastery-trend ${Number(row.trend)>0?'good':Number(row.trend)<0?'warn':''}">${Number(row.trend)>0?'↑':Number(row.trend)<0?'↓':'→'} ${Math.abs(Math.round(Number(row.trend)))} п.п.</span>`;
    return `<button class="mr-mastery-tile ${s.key}" data-mastery-topic="${row.topic_id}"><div class="mr-mastery-tile-head"><span>${esc(row.topics?.section||'Тема')}</span><b>${score}</b></div><strong>${esc(row.topics?.title||'Тема')}</strong><div class="mr-mastery-bar"><i style="width:${row.mastery==null?0:Math.max(2,Math.min(100,Number(row.mastery)))}%"></i></div><div class="mr-mastery-foot"><span class="pill">${s.label}</span>${compact?'':`<small>${row.evidence_count||0} сигналов</small>`}${trend}</div></button>`;
  }

  function openTopicMasteryDetail(row) {
    const s = masteryStatus(row.mastery,row.evidence_count);
    const component = (label,value,count) => `<div class="mr-mastery-component"><span>${label}</span><b>${value==null?'—':Math.round(Number(value))+'%'}</b><small>${count||0} наблюд.</small></div>`;
    const d = row.details || {};
    const m = modal(`<div class="mr-card-head"><div><span class="pill">${esc(row.topics?.section||'Курс')}</span><h2>${esc(row.topics?.title||'Тема')}</h2></div><span class="pill ${s.key==='attention'?'warn':s.key==='mastered'?'good':''}">${s.label}</span></div>
      <div class="mr-mastery-detail-score"><b>${row.mastery==null?'—':Math.round(Number(row.mastery))+'%'}</b><div><span>Сводное освоение</span><small>${row.evidence_count||0} учебных сигналов${row.last_activity_at?` · последнее ${new Date(row.last_activity_at).toLocaleDateString('ru-RU')}`:''}</small></div></div>
      <div class="mr-mastery-components">${component('Уроки',row.lesson_score,d.lessons)}${component('Домашние',row.homework_score,d.homeworks)}${component('Тесты',row.test_score,d.tests)}${component('Повторение',row.review_score,d.review_signals)}</div>
      <div class="notice"><b>Интерпретация:</b> итоговый процент — это взвешенная сводка реальных результатов, а не отдельная оценка. Уроки имеют наибольший вес, затем тесты/ДЗ и сигналы интервального повторения.</div>
      <button class="btn modal-default-close">Закрыть</button>`,'wide-modal');
    m.querySelector('.modal-default-close').onclick=()=>m.remove();
  }

  async function openMasteryMap(studentId, studentMode = false, provided = null) {
    try {
      let rows = provided;
      if (!rows) {
        if (studentMode) { const {data,error}=await sb.rpc('get_my_topic_mastery'); if(error) throw error; rows=Array.isArray(data)?data:[]; }
        else rows = await getTopicMastery(studentId,true);
      }
      const st = studentMode ? S.student : (S.students||[]).find(x=>x.id===studentId);
      const m = modal(`<div class="mr-card-head"><div><h2>Карта освоения курса</h2><p class="muted">${esc(st?.name||'Ученик')} · темы сгруппированы по разделам и уровню освоения.</p></div><span class="pill">${rows.length} тем</span></div><div class="actions mr-mastery-filters"><button class="btn sm primary" data-mf="all">Все</button><button class="btn sm" data-mf="attention">Внимание</button><button class="btn sm" data-mf="working">В работе</button><button class="btn sm" data-mf="confident">Уверенно</button><button class="btn sm" data-mf="mastered">Освоено</button><button class="btn sm" data-mf="no_data">Нет данных</button></div><div id="mrMasteryMapBody"></div>`,'wide-modal');
      let filter='all';
      const paint=()=>{
        const filtered=rows.filter(r=>filter==='all'||masteryStatus(r.mastery,r.evidence_count).key===filter);
        const groups=new Map();
        for(const r of filtered){const key=r.topics?.section||'Без раздела';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
        m.querySelector('#mrMasteryMapBody').innerHTML=filtered.length?[...groups.entries()].map(([section,items])=>`<section class="mr-mastery-section"><div class="mr-mastery-section-head"><h3>${esc(section)}</h3><span>${items.length}</span></div><div class="mr-mastery-grid">${items.map(x=>masteryTile(x)).join('')}</div></section>`).join(''):'<div class="empty">Нет тем для выбранного фильтра.</div>';
        m.querySelectorAll('[data-mastery-topic]').forEach(b=>b.onclick=()=>{const row=rows.find(x=>String(x.topic_id)===String(b.dataset.masteryTopic));if(row)openTopicMasteryDetail(row)});
        m.querySelectorAll('[data-mf]').forEach(b=>b.classList.toggle('primary',b.dataset.mf===filter));
      };
      m.querySelectorAll('[data-mf]').forEach(b=>b.onclick=()=>{filter=b.dataset.mf;paint()});
      paint();
    } catch(e){ fail(e); }
  }

  async function buildTeacherActivity(studentId) {
    const [attemptRes,goalRes] = await Promise.all([
      sb.from('homework_attempts').select('homework_id,attempt_no,auto_score,final_score,submitted_at,reviewed_at').eq('student_id',studentId).order('submitted_at',{ascending:false}).limit(120),
      sb.from('student_goals').select('id,title,status,created_at,updated_at,completed_at').eq('student_id',studentId).order('updated_at',{ascending:false})
    ]);
    if (attemptRes.error) throw attemptRes.error; if (goalRes.error) throw goalRes.error;
    const events=[];
    const add=(kind,title,at,detail='')=>{if(at)events.push({kind,title,at,detail})};
    for(const l of (S.lessons||[]).filter(x=>x.student_id===studentId)){
      if(l.status==='completed') add('lesson',`Урок завершён · ${l.topics?.title||'Без темы'}`,l.completed_at||l.started_at||l.scheduled_at,`${l.duration_minutes||0} мин`);
    }
    const hwById=new Map((S.homeworks||[]).filter(x=>x.student_id===studentId).map(x=>[x.id,x]));
    for(const h of hwById.values()){
      add('homework',`ДЗ назначено · ${h.title}`,h.created_at,h.due_at?`срок ${new Date(h.due_at).toLocaleDateString('ru-RU')}`:'');
      if(h.revision_requested_at) add('homework',`ДЗ возвращено на доработку · ${h.title}`,h.revision_requested_at,h.revision_message||'');
      if(h.reviewed_at) add('homework',`ДЗ проверено · ${h.title}`,h.reviewed_at,h.score!=null?`${Math.round(Number(h.score))}%`:h.comment||'');
    }
    for(const a of (attemptRes.data||[])){
      const h=hwById.get(a.homework_id); add('homework',`ДЗ сдано · ${h?.title||'Домашняя работа'}`,a.submitted_at,`попытка ${a.attempt_no} · авто ${Math.round(Number(a.auto_score||0))}%`);
    }
    for(const t of (S.tests||[]).filter(x=>x.student_id===studentId&&x.submitted_at)) add('test',`Тест выполнен · ${t.title}`,t.submitted_at,t.score!=null?`${Math.round(Number(t.score))}%`:'');
    for(const g of (goalRes.data||[])){
      add('goal',`Цель добавлена · ${g.title}`,g.created_at,'');
      if(g.completed_at) add('goal',`Цель достигнута · ${g.title}`,g.completed_at,'100%');
    }
    return events.sort((a,b)=>new Date(b.at)-new Date(a.at));
  }

  function activityIcon(kind){return kind==='lesson'?'◉':kind==='homework'?'⌂':kind==='test'?'✓':kind==='goal'?'◎':'•'}
  function activityLabel(kind){return kind==='lesson'?'Уроки':kind==='homework'?'Домашние':kind==='test'?'Тесты':kind==='goal'?'Цели':'Другое'}
  function activityRowsHtml(events){return events.length?`<div class="mr-activity-list">${events.map(e=>`<div class="mr-activity-item ${e.kind}"><span class="mr-activity-icon">${activityIcon(e.kind)}</span><div><b>${esc(e.title)}</b>${e.detail?`<small>${esc(e.detail)}</small>`:''}</div><time>${activityWhen(e.at)}</time></div>`).join('')}</div>`:'<div class="empty">Событий пока нет.</div>'}

  async function openActivityJournal(studentId, studentMode=false, provided=null) {
    try {
      let events=provided;
      if(!events){
        if(studentMode){const {data,error}=await sb.rpc('get_my_activity',{p_limit:80});if(error)throw error;events=Array.isArray(data)?data:[];}
        else events=await buildTeacherActivity(studentId);
      }
      const st=studentMode?S.student:(S.students||[]).find(x=>x.id===studentId);
      const m=modal(`<div class="mr-card-head"><div><h2>Журнал активности</h2><p class="muted">${esc(st?.name||'Ученик')} · уроки, домашние, тесты и цели в одной ленте.</p></div><button class="btn sm" id="mrActivityCopy">Скопировать 30 дней</button></div><div class="actions mr-activity-filters"><button class="btn sm primary" data-af="all">Все</button><button class="btn sm" data-af="lesson">Уроки</button><button class="btn sm" data-af="homework">ДЗ</button><button class="btn sm" data-af="test">Тесты</button><button class="btn sm" data-af="goal">Цели</button></div><div id="mrActivityBody"></div>`,'wide-modal');
      let filter='all';
      const paint=()=>{const xs=events.filter(e=>filter==='all'||e.kind===filter);m.querySelector('#mrActivityBody').innerHTML=activityRowsHtml(xs);m.querySelectorAll('[data-af]').forEach(b=>b.classList.toggle('primary',b.dataset.af===filter));};
      m.querySelectorAll('[data-af]').forEach(b=>b.onclick=()=>{filter=b.dataset.af;paint()});
      m.querySelector('#mrActivityCopy').onclick=async()=>{const since=Date.now()-30*86400000;const xs=events.filter(e=>new Date(e.at).getTime()>=since);const body=[`Активность — ${st?.name||'ученик'} · последние 30 дней`,...xs.map(e=>`${new Date(e.at).toLocaleDateString('ru-RU')} · ${activityLabel(e.kind)} · ${e.title}${e.detail?` — ${e.detail}`:''}`)].join('\n');await copyText(body);toast('Сводка активности скопирована')};
      paint();
    } catch(e){fail(e)}
  }

  async function enhanceMasteryOverview() {
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrMasteryOverview'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const rows=await getTopicMastery(S.selectedStudent,true);if(S.view!=='profile'||document.querySelector('#mrMasteryOverview'))return;
      const classified=rows.map(r=>({...r,_s:masteryStatus(r.mastery,r.evidence_count)}));
      const attention=classified.filter(x=>x._s.key==='attention').length, working=classified.filter(x=>x._s.key==='working').length, mastered=classified.filter(x=>x._s.key==='mastered').length, noData=classified.filter(x=>x._s.key==='no_data').length;
      const focus=classified.filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery)).slice(0,6);
      const box=document.createElement('div');box.id='mrMasteryOverview';box.className='card mr-mastery-overview';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Карта освоения курса</h2><p class="small muted">Сводка по урокам, домашним, тестам и повторению.</p></div><button class="btn sm primary" id="mrMasteryOpen">Открыть карту</button></div><div class="mr-mastery-summary"><span><b>${mastered}</b><small>освоено</small></span><span><b>${working}</b><small>в работе</small></span><span><b>${attention}</b><small>внимание</small></span><span><b>${noData}</b><small>нет данных</small></span></div>${focus.length?`<div class="mr-mastery-grid compact">${focus.map(x=>masteryTile(x,true)).join('')}</div>`:'<div class="empty">Карта наполнится после первых результатов.</div>'}`;
      const anchor=document.querySelector('#mrSmartPrep')||document.querySelector('#mrGoalsOverview')||content.querySelector('.profile-metrics');anchor?.insertAdjacentElement('afterend',box);
      box.querySelector('#mrMasteryOpen').onclick=()=>openMasteryMap(S.selectedStudent,false,rows);
      box.querySelectorAll('[data-mastery-topic]').forEach(b=>b.onclick=()=>{const row=rows.find(x=>String(x.topic_id)===String(b.dataset.masteryTopic));if(row)openTopicMasteryDetail(row)});
    }catch(e){console.warn('[Mathroom mastery]',e)}
  }

  async function enhanceActivityOverview() {
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrActivityOverview'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const events=await buildTeacherActivity(S.selectedStudent);if(S.view!=='profile'||document.querySelector('#mrActivityOverview'))return;
      const month=events.filter(x=>new Date(x.at).getTime()>=Date.now()-30*86400000);
      const box=document.createElement('div');box.id='mrActivityOverview';box.className='card mr-activity-overview';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Журнал активности</h2><p class="small muted">${month.length} событий за последние 30 дней${events[0]?` · последнее ${activityWhen(events[0].at)}`:''}</p></div><button class="btn sm" id="mrActivityOpen">Весь журнал</button></div>${activityRowsHtml(events.slice(0,6))}`;
      const anchor=document.querySelector('#mrMasteryOverview')||document.querySelector('#mrSmartPrep')||document.querySelector('#mrGoalsOverview');anchor?.insertAdjacentElement('afterend',box);
      box.querySelector('#mrActivityOpen').onclick=()=>openActivityJournal(S.selectedStudent,false,events);
    }catch(e){console.warn('[Mathroom activity]',e)}
  }

  async function enhanceStudentMastery() {
    if(!S.access||S.studentTab!=='progress'||!S.student||document.querySelector('#mrStudentMastery'))return;
    const content=document.querySelector('#studentContent');if(!content)return;
    try{
      const {data,error}=await sb.rpc('get_my_topic_mastery');if(error)throw error;const rows=Array.isArray(data)?data:[];
      if(S.studentTab!=='progress'||document.querySelector('#mrStudentMastery'))return;
      const known=rows.filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery));
      const mastered=rows.filter(x=>masteryStatus(x.mastery,x.evidence_count).key==='mastered').length;
      const attention=rows.filter(x=>masteryStatus(x.mastery,x.evidence_count).key==='attention').length;
      const box=document.createElement('div');box.id='mrStudentMastery';box.className='card mr-student-mastery';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Карта тем</h2><p class="small muted">Как меняется освоение курса по реальным результатам.</p></div><button class="btn sm" id="mrStudentMasteryOpen">Все темы</button></div><div class="mr-master-student-meta"><span><b>${mastered}</b> освоено</span><span><b>${attention}</b> требуют внимания</span></div>${known.length?`<div class="mr-mastery-grid compact">${known.slice(0,6).map(x=>masteryTile(x,true)).join('')}</div>`:'<div class="empty">Карта появится после первых результатов.</div>'}`;
      const review=document.querySelector('#mrStudentReview');if(review)review.insertAdjacentElement('afterend',box);else content.prepend(box);
      box.querySelector('#mrStudentMasteryOpen').onclick=()=>openMasteryMap(S.student.id,true,rows);
      box.querySelectorAll('[data-mastery-topic]').forEach(b=>b.onclick=()=>{const row=rows.find(x=>String(x.topic_id)===String(b.dataset.masteryTopic));if(row)openTopicMasteryDetail(row)});
    }catch(e){console.warn('[Mathroom student mastery]',e)}
  }

  async function enhanceStudentActivity() {
    if(!S.access||S.studentTab!=='progress'||!S.student||document.querySelector('#mrStudentActivity'))return;
    const content=document.querySelector('#studentContent');if(!content)return;
    try{
      const {data,error}=await sb.rpc('get_my_activity',{p_limit:30});if(error)throw error;const events=Array.isArray(data)?data:[];
      if(S.studentTab!=='progress'||document.querySelector('#mrStudentActivity'))return;
      const box=document.createElement('div');box.id='mrStudentActivity';box.className='card mr-student-activity';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Моя активность</h2><p class="small muted">Последние занятия и выполненные задания.</p></div><button class="btn sm" id="mrStudentActivityOpen">Показать всё</button></div>${activityRowsHtml(events.slice(0,6))}`;
      const mastery=document.querySelector('#mrStudentMastery');if(mastery)mastery.insertAdjacentElement('afterend',box);else content.append(box);
      box.querySelector('#mrStudentActivityOpen').onclick=()=>openActivityJournal(S.student.id,true,events);
    }catch(e){console.warn('[Mathroom student activity]',e)}
  }



  // ---- Cumulative WIP: teacher preparation center + 4-lesson roadmap ----
  let prepCenterBusy = false;
  const prepCache = { at: 0, data: null };
  const prepSoonMs = 36 * 3600000;

  function futureLessons(studentId = null, limit = 8) {
    return (S.lessons || [])
      .filter(x => x.status === 'assigned' && x.scheduled_at && new Date(x.scheduled_at).getTime() >= Date.now() && (!studentId || x.student_id === studentId))
      .sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .slice(0, limit);
  }

  function lessonStudent(lesson) { return (S.students || []).find(x => x.id === lesson?.student_id); }
  function lessonTopic(lesson) { return (S.topics || []).find(x => x.id === lesson?.topic_id); }
  function compactWhen(value) {
    if (!value) return 'без даты';
    const d = new Date(value), now = new Date();
    const same = d.toDateString() === now.toDateString();
    return same ? `Сегодня, ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}` : d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  async function loadPrepDataset(force = false) {
    if (!force && prepCache.data && Date.now() - prepCache.at < 45000) return prepCache.data;
    const lessons = futureLessons(null, 8), lessonIds = lessons.map(x=>x.id), studentIds = [...new Set(lessons.map(x=>x.student_id))];
    const empty = { data: [], error: null };
    const [plansR, queueR, reviewR, masteryR, goalsR, snoozeR] = await Promise.all([
      lessonIds.length ? sb.from('lesson_plans').select('*').in('lesson_id',lessonIds) : Promise.resolve(empty),
      lessonIds.length ? sb.from('lesson_queue_items').select('id,lesson_id,status').in('lesson_id',lessonIds) : Promise.resolve(empty),
      studentIds.length ? sb.from('student_review_items').select('*').in('student_id',studentIds).eq('is_archived',false) : Promise.resolve(empty),
      studentIds.length ? sb.from('student_topic_mastery').select('student_id,topic_id,mastery,status,evidence_count,trend,topics(title,section)').in('student_id',studentIds) : Promise.resolve(empty),
      studentIds.length ? sb.from('student_goals').select('id,student_id,title,progress,status,target_date').in('student_id',studentIds).eq('status','active') : Promise.resolve(empty),
      studentIds.length ? sb.from('student_alert_snoozes').select('*').in('student_id',studentIds) : Promise.resolve(empty)
    ]);
    for (const r of [plansR,queueR,reviewR,masteryR,goalsR,snoozeR]) if (r.error) throw r.error;
    const data = { lessons, plans:plansR.data||[], queue:queueR.data||[], review:reviewR.data||[], mastery:masteryR.data||[], goals:goalsR.data||[], snoozes:snoozeR.data||[] };
    prepCache.at = Date.now(); prepCache.data = data; return data;
  }

  function alertSeverityRank(v){ return v==='critical'?3:v==='warn'?2:1; }
  function alertPill(v){ return v==='critical'?'danger':v==='warn'?'warn':''; }
  function isSnoozed(dataset, studentId, key) {
    const row = (dataset.snoozes||[]).find(x=>x.student_id===studentId&&x.alert_key===key);
    return !!(row?.snoozed_until && new Date(row.snoozed_until).getTime() > Date.now());
  }

  function prepAlertsForLesson(lesson, dataset, { includeSnoozed = false } = {}) {
    const sid = lesson.student_id, now = Date.now(), when = new Date(lesson.scheduled_at).getTime();
    const plan = dataset.plans.find(x=>x.lesson_id===lesson.id), q = dataset.queue.filter(x=>x.lesson_id===lesson.id);
    const hws = (S.homeworks||[]).filter(x=>x.student_id===sid), alerts=[];
    const push=(key,severity,title,detail='')=>{ if(includeSnoozed || !isSnoozed(dataset,sid,key)) alerts.push({key,severity,title,detail}); };
    const submitted=hws.filter(x=>x.status==='submitted');
    const revision=hws.filter(x=>x.status==='assigned'&&x.revision_requested_at);
    const overdue=hws.filter(x=>x.status==='assigned'&&x.due_at&&new Date(x.due_at).getTime()<now&&!x.revision_requested_at);
    if(submitted.length) push('homework-review','critical',`${submitted.length} ДЗ ждёт проверки`,'Лучше проверить до следующего занятия.');
    if(revision.length) push('homework-revision','warn',`${revision.length} ДЗ на доработке`,'Ученик получил комментарии, но работа ещё не закрыта.');
    if(overdue.length) push('homework-overdue','warn',`${overdue.length} просроченных ДЗ`,'Стоит решить, переносить срок или разобрать причину на уроке.');
    const dueReview=(dataset.review||[]).filter(x=>x.student_id===sid&&effectiveReviewDate(x)<=isoDay(lesson.scheduled_at));
    if(dueReview.length) push('review-due','warn',`${dueReview.length} зон пора повторить`,dueReview.sort((a,b)=>reviewPriority(b)-reviewPriority(a)).slice(0,3).map(x=>(x.kind==='tag'?'#':'')+x.label).join(' · '));
    const weak=(dataset.mastery||[]).filter(x=>x.student_id===sid&&x.mastery!=null&&Number(x.mastery)<60).sort((a,b)=>Number(a.mastery)-Number(b.mastery));
    if(weak.length) push('mastery-attention','info',`${weak.length} тем требуют внимания`,weak.slice(0,3).map(x=>`${x.topics?.title||'Тема'} ${Math.round(Number(x.mastery))}%`).join(' · '));
    const goals=(dataset.goals||[]).filter(x=>x.student_id===sid&&x.target_date);
    const soonGoals=goals.filter(g=>{const d=new Date(`${g.target_date}T23:59:59`).getTime();return d>=now&&d-now<=14*86400000&&Number(g.progress||0)<85});
    if(soonGoals.length) push('goal-deadline','warn','Близкий срок учебной цели',soonGoals.slice(0,2).map(g=>`${g.title} · ${g.progress||0}%`).join(' · '));
    if(when-now<=prepSoonMs && !plan?.main_goal) push('plan-missing','critical','Нет цели и плана урока','До занятия осталось меньше 36 часов.');
    if(when-now<=prepSoonMs && q.length<3) push('queue-short','warn',q.length?'В очереди мало задач':'Очередь задач пустая',`${q.length} задач подготовлено; ориентир — хотя бы 3.`);
    if(plan?.prep_status!=='ready') push('prep-not-ready','info','Подготовка не отмечена готовой','Открой чек-лист перед занятием.');
    return alerts.sort((a,b)=>alertSeverityRank(b.severity)-alertSeverityRank(a.severity));
  }

  function prepChecklist(plan, queueCount, alerts) {
    const saved = new Map((Array.isArray(plan?.prep_checklist)?plan.prep_checklist:[]).map(x=>[x.key,!!x.done]));
    return [
      {key:'homework',label:'Проверить прошлое ДЗ и комментарии',done:saved.get('homework')||!alerts.some(a=>['homework-review','homework-revision','homework-overdue'].includes(a.key)),manual:true},
      {key:'review',label:'Просмотреть, что нужно повторить',done:saved.get('review')||!alerts.some(a=>a.key==='review-due'),manual:true},
      {key:'plan',label:'Заполнить цель и структуру урока',done:!!plan?.main_goal,auto:true},
      {key:'queue',label:'Подготовить минимум 3 задачи',done:Number(queueCount)>=3,auto:true},
      {key:'tech',label:'Проверить ссылку, камеру и материалы',done:saved.get('tech')||false,manual:true}
    ];
  }

  async function savePrepChecklist(lessonId, studentId, lesson, items, status = null) {
    let plan = await getLessonPlan(lessonId);
    const payload = {
      teacher_id:S.user.id, lesson_id:lessonId, student_id:studentId,
      main_goal:plan?.main_goal||'', objectives:plan?.objectives||[], agenda:plan?.agenda||[], homework_intent:plan?.homework_intent||'', teacher_note:plan?.teacher_note||'', goal_ids:plan?.goal_ids||[],
      prep_checklist:items.filter(x=>x.manual).map(x=>({key:x.key,done:!!x.done})), prep_status:status||plan?.prep_status||'draft', prepared_at:status==='ready'?new Date().toISOString():(plan?.prepared_at||null), updated_at:new Date().toISOString()
    };
    const {error}=await sb.from('lesson_plans').upsert(payload,{onConflict:'lesson_id'}); if(error) throw error;
    prepCache.at=0;
  }

  async function snoozeStudentAlert(studentId,key,days=7){
    const until=addDays(new Date(),days).toISOString();
    const {error}=await sb.from('student_alert_snoozes').upsert({teacher_id:S.user.id,student_id:studentId,alert_key:key,snoozed_until:until,updated_at:new Date().toISOString()},{onConflict:'student_id,alert_key'});if(error)throw error;
    prepCache.at=0;
  }

  async function buildDraftForLesson(lesson) {
    const sid=lesson.student_id, when=lesson.scheduled_at||new Date().toISOString();
    const [review, goals, latestR, masteryRows, existing] = await Promise.all([
      getReviewQueue(sid,true), getStudentGoals(sid,false),
      sb.from('lesson_reports').select('public_focus,public_highlights,created_at').eq('student_id',sid).order('created_at',{ascending:false}).limit(1).then(x=>x.error?Promise.reject(x.error):x.data||[]),
      getTopicMastery(sid,true), getLessonPlan(lesson.id)
    ]);
    const due=review.filter(x=>effectiveReviewDate(x)<=isoDay(when)).sort((a,b)=>reviewPriority(b)-reviewPriority(a));
    const weak=(masteryRows||[]).filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery)).slice(0,4);
    const topic=lessonTopic(lesson), last=latestR[0], reviewLabels=due.slice(0,3).map(x=>x.label), weakTitles=weak.slice(0,2).map(x=>x.topics?.title).filter(Boolean);
    const main = reviewLabels.length ? `Закрепить ${reviewLabels.slice(0,2).join(' и ')} и продолжить «${topic?.title||'тему урока'}»` : weakTitles.length ? `Вернуться к «${weakTitles[0]}» и продолжить «${topic?.title||'тему урока'}»` : `Отработать тему «${topic?.title||'урока'}»`;
    const objectives=[...new Set([reviewLabels.length?`Повторить: ${reviewLabels.join(', ')}`:'',weakTitles.length?`Контроль слабых тем: ${weakTitles.join(', ')}`:'',last?.public_focus?String(last.public_focus).replace(/^Повторить:\s*/i,'').trim():'',`Довести до самостоятельного решения задач по теме «${topic?.title||'урока'}»`].filter(Boolean))];
    const agenda=(Array.isArray(existing?.agenda)&&existing.agenda.length)?existing.agenda:[
      {title:'Входная проверка и повторение',minutes:10,done:false,position:0},
      {title:'Ключевой материал',minutes:15,done:false,position:1},
      {title:'Основная практика',minutes:25,done:false,position:2},
      {title:'Самостоятельная задача',minutes:7,done:false,position:3},
      {title:'Итоги и домашняя работа',minutes:3,done:false,position:4}
    ];
    const payload={teacher_id:S.user.id,lesson_id:lesson.id,student_id:sid,main_goal:main,objectives,agenda,homework_intent:reviewLabels.length?`Закрепить: ${reviewLabels.join(', ')}`:(existing?.homework_intent||''),teacher_note:existing?.teacher_note||`Авточерновик Mathroom. Проверить перед уроком.${last?.public_highlights?` Последний успех: ${last.public_highlights}`:''}`,goal_ids:(existing?.goal_ids?.length?existing.goal_ids:goals.slice(0,3).map(x=>x.id)),prep_checklist:existing?.prep_checklist||[],prep_status:'draft',prepared_at:null,updated_at:new Date().toISOString()};
    const {error}=await sb.from('lesson_plans').upsert(payload,{onConflict:'lesson_id'});if(error)throw error;
    prepCache.at=0; return {payload,due,review,weak};
  }

  async function openLessonPreparation(lessonId) {
    try {
      const lesson=(S.lessons||[]).find(x=>x.id===lessonId); if(!lesson)return toast('Урок не найден');
      const dataset=await loadPrepDataset(true); let plan=dataset.plans.find(x=>x.lesson_id===lesson.id)||await getLessonPlan(lesson.id);
      const q=dataset.queue.filter(x=>x.lesson_id===lesson.id), alerts=prepAlertsForLesson(lesson,dataset,{includeSnoozed:true});
      let checks=prepChecklist(plan,q.length,alerts); const st=lessonStudent(lesson),topic=lessonTopic(lesson);
      const m=modal(`<div class="mr-card-head"><div><h2>Подготовка к уроку</h2><p class="muted">${esc(st?.name||'Ученик')} · ${esc(topic?.title||'Без темы')} · ${esc(compactWhen(lesson.scheduled_at))}</p></div><span class="pill ${plan?.prep_status==='ready'?'good':''}" id="mrPrepState">${plan?.prep_status==='ready'?'Готово':'Черновик'}</span></div>
        <div class="mr-prep-columns"><section><h3>Что нельзя упустить</h3><div id="mrPrepAlerts">${alerts.length?alerts.map(a=>`<div class="mr-attention-row ${a.severity}"><span class="pill ${alertPill(a.severity)}">${a.severity==='critical'?'Важно':a.severity==='warn'?'Внимание':'Учесть'}</span><div><b>${esc(a.title)}</b>${a.detail?`<small>${esc(a.detail)}</small>`:''}</div><button class="btn xs" data-snooze-alert="${esc(a.key)}">+7 дн</button></div>`).join(''):'<div class="notice">Критичных хвостов по текущим данным нет.</div>'}</div></section>
        <section><h3>Чек-лист перед занятием</h3><div class="mr-prep-checklist" id="mrPrepChecklist">${checks.map(x=>`<label class="${x.auto?'auto':''}"><input type="checkbox" data-prep-check="${x.key}" ${x.done?'checked':''} ${x.auto?'disabled':''}><span>${esc(x.label)}</span>${x.auto?'<small>авто</small>':''}</label>`).join('')}</div></section></div>
        <div class="notice"><b>Цель:</b> ${esc(plan?.main_goal||'ещё не заполнена')}<br><span class="small muted">Очередь: ${q.length} задач · этапов плана: ${(plan?.agenda||[]).length}</span></div>
        <div class="actions mr-prep-actions"><button class="btn" id="mrPrepAuto">⚡ Собрать черновик</button><button class="btn" id="mrPrepTasks">+ 3 задачи повторения</button><button class="btn" id="mrPrepRoadmap">План на 4 занятия</button><button class="btn primary" id="mrPrepReady">✓ Готов к уроку</button></div>`, 'wide-modal');
      const syncManual=async()=>{checks=checks.map(x=>x.manual?{...x,done:!!m.querySelector(`[data-prep-check="${x.key}"]`)?.checked}:x);await savePrepChecklist(lesson.id,lesson.student_id,lesson,checks);toast('Чек-лист сохранён')};
      m.querySelectorAll('[data-prep-check]:not([disabled])').forEach(x=>x.onchange=()=>syncManual().catch(fail));
      m.querySelectorAll('[data-snooze-alert]').forEach(b=>b.onclick=async()=>{try{await snoozeStudentAlert(lesson.student_id,b.dataset.snoozeAlert,7);b.closest('.mr-attention-row')?.remove();toast('Напоминание скрыто на 7 дней')}catch(e){fail(e)}});
      m.querySelector('#mrPrepAuto').onclick=async()=>{try{await buildDraftForLesson(lesson);m.remove();await openLessonPreparation(lesson.id);toast('Черновик плана обновлён')}catch(e){fail(e)}};
      m.querySelector('#mrPrepTasks').onclick=async()=>{try{const review=await getReviewQueue(lesson.student_id,true);const due=review.filter(x=>effectiveReviewDate(x)<=isoDay(lesson.scheduled_at));const tasks=await recommendedExercisesForReview(lesson.student_id,due.length?due:review,5);if(!tasks.length)return toast('Подходящих задач пока нет');await applyExercisesToQueue({role:'teacher',lessonId:lesson.id,studentId:lesson.student_id,lesson},tasks.slice(0,3).map(x=>x.id));prepCache.at=0;m.remove();await openLessonPreparation(lesson.id)}catch(e){fail(e)}};
      m.querySelector('#mrPrepRoadmap').onclick=()=>openLearningRoadmap(lesson.student_id);
      m.querySelector('#mrPrepReady').onclick=async()=>{try{plan=await getLessonPlan(lesson.id);const {data:qs,error}=await sb.from('lesson_queue_items').select('id').eq('lesson_id',lesson.id);if(error)throw error;checks=prepChecklist(plan,(qs||[]).length,alerts).map(x=>x.manual?{...x,done:!!m.querySelector(`[data-prep-check="${x.key}"]`)?.checked}:x);const missing=checks.filter(x=>!x.done);if(missing.length&&!confirm(`Не отмечено пунктов: ${missing.length}. Всё равно отметить урок готовым?`))return;await savePrepChecklist(lesson.id,lesson.student_id,lesson,checks,'ready');m.querySelector('#mrPrepState').textContent='Готово';m.querySelector('#mrPrepState').classList.add('good');document.querySelector('#mrTeacherWorkday')?.remove();document.querySelector('#mrTeacherActionCenter')?.remove();scheduleSync();toast('Урок отмечен подготовленным')}catch(e){fail(e)}};
    } catch(e){fail(e)}
  }

  function roadmapSlotTopic(slot){ return slot.topic_title||'Тема будет уточнена'; }
  function roadmapCard(slot,i,editable=true){
    return `<article class="mr-roadmap-slot" data-roadmap-index="${i}"><div class="mr-roadmap-index">${i+1}</div><div class="mr-roadmap-slot-body"><div class="mr-roadmap-head"><b>${esc(roadmapSlotTopic(slot))}</b><span class="pill">${slot.scheduled_at?esc(compactWhen(slot.scheduled_at)):`занятие ${i+1}`}</span></div>${editable?`<div class="field"><label>Цель</label><input data-roadmap-goal value="${esc(slot.main_goal||'')}"></div><div class="field"><label>Фокус / результаты</label><textarea rows="3" data-roadmap-focus>${esc((slot.focus||[]).join('\n'))}</textarea></div><div class="field"><label>Домашняя логика</label><input data-roadmap-homework value="${esc(slot.homework_intent||'')}"></div>`:`<p>${esc(slot.main_goal||'')}</p><div class="mr-review-mini">${(slot.focus||[]).slice(0,4).map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>`}${slot.rationale?`<small>${esc(slot.rationale)}</small>`:''}</div></article>`;
  }

  async function generateLearningRoadmap(studentId, horizon=4) {
    const [review, mastery, goals, reports] = await Promise.all([
      getReviewQueue(studentId,true), getTopicMastery(studentId,true), getStudentGoals(studentId,false),
      sb.from('lesson_reports').select('public_focus,public_highlights,created_at').eq('student_id',studentId).order('created_at',{ascending:false}).limit(2).then(x=>x.error?Promise.reject(x.error):x.data||[])
    ]);
    const upcoming=futureLessons(studentId,horizon), weak=(mastery||[]).filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery));
    const reviewSorted=[...review].sort((a,b)=>reviewPriority(b)-reviewPriority(a)); const last=reports[0];
    const slots=[];
    for(let i=0;i<horizon;i++){
      const lesson=upcoming[i]||null, scheduledTopic=lessonTopic(lesson), weakTopic=weak[i%Math.max(1,Math.min(weak.length,4))]?.topics?.title||'';
      const focusReview=reviewSorted.slice(i*2,i*2+2).map(x=>(x.kind==='tag'?'#':'')+x.label);
      const topicTitle=scheduledTopic?.title||weakTopic||goals[i%Math.max(1,goals.length)]?.title||`Занятие ${i+1}`;
      const stage=i===0?'Снять актуальные пробелы':i===1?'Закрепить способ решения':i===2?'Повысить самостоятельность':'Контроль и перенос навыка';
      const focus=[...new Set([stage,...focusReview,weakTopic&&weakTopic!==topicTitle?`Вернуться: ${weakTopic}`:'',i===0&&last?.public_focus?String(last.public_focus).replace(/^Повторить:\s*/i,'').trim():''].filter(Boolean))];
      slots.push({index:i+1,lesson_id:lesson?.id||null,scheduled_at:lesson?.scheduled_at||null,topic_id:lesson?.topic_id||weak[i]?.topic_id||null,topic_title:topicTitle,main_goal:`${stage}: ${topicTitle}`,focus,homework_intent:i<horizon-1?'Коротко закрепить ключевой навык и подготовить переход к следующему шагу':'Контрольное закрепление без перегруза',rationale:lesson?`Учтён запланированный урок и текущая аналитика.`:`Слот без даты — тема предложена из карты освоения и повторения.`});
    }
    return {slots,source:{generated_at:new Date().toISOString(),review:reviewSorted.slice(0,8).map(x=>({kind:x.kind,label:x.label,mastery:x.mastery,due:effectiveReviewDate(x)})),weak_topics:weak.slice(0,6).map(x=>({topic_id:x.topic_id,title:x.topics?.title,mastery:x.mastery})),goals:goals.slice(0,4).map(x=>({id:x.id,title:x.title,progress:x.progress}))}};
  }

  function readRoadmapModal(m,slots){
    return slots.map((s,i)=>{const card=m.querySelector(`[data-roadmap-index="${i}"]`);return{...s,main_goal:card?.querySelector('[data-roadmap-goal]')?.value.trim()||s.main_goal,focus:(card?.querySelector('[data-roadmap-focus]')?.value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean),homework_intent:card?.querySelector('[data-roadmap-homework]')?.value.trim()||''}})
  }

  async function saveRoadmap(studentId,slots,source,existing=null){
    const payload={teacher_id:S.user.id,student_id:studentId,title:'План на 4 занятия',horizon_count:slots.length,plan:slots,source_snapshot:source||{},status:'active',generated_at:source?.generated_at||new Date().toISOString(),updated_at:new Date().toISOString()};
    let res;
    if(existing?.id) res=await sb.from('student_learning_roadmaps').update(payload).eq('id',existing.id).select().single();
    else res=await sb.from('student_learning_roadmaps').insert(payload).select().single();
    if(res.error) throw res.error; return res.data;
  }

  async function applyRoadmapToLessons(studentId,slots){
    const applicable=slots.filter(x=>x.lesson_id); if(!applicable.length)return toast('В дорожной карте пока нет запланированных уроков');
    const {data:existing,error}=await sb.from('lesson_plans').select('*').in('lesson_id',applicable.map(x=>x.lesson_id));if(error)throw error;const by=new Map((existing||[]).map(x=>[x.lesson_id,x]));
    if(!confirm(`Применить черновики к ${applicable.length} запланированным урокам? Цели и результаты уроков будут обновлены.`))return;
    const defaultAgenda=[{title:'Повторение',minutes:10,done:false,position:0},{title:'Основной блок',minutes:35,done:false,position:1},{title:'Самостоятельная практика',minutes:10,done:false,position:2},{title:'Итоги',minutes:5,done:false,position:3}];
    const rows=applicable.map(s=>{const old=by.get(s.lesson_id);return{teacher_id:S.user.id,lesson_id:s.lesson_id,student_id:studentId,main_goal:s.main_goal,objectives:s.focus,agenda:old?.agenda?.length?old.agenda:defaultAgenda,homework_intent:s.homework_intent,teacher_note:old?.teacher_note||'Черновик из плана на 4 занятия. Проверить перед уроком.',goal_ids:old?.goal_ids||[],prep_checklist:old?.prep_checklist||[],prep_status:'draft',prepared_at:null,updated_at:new Date().toISOString()}});
    const {error:upErr}=await sb.from('lesson_plans').upsert(rows,{onConflict:'lesson_id'});if(upErr)throw upErr;prepCache.at=0;toast(`Черновики применены: ${rows.length}`);
  }

  async function getActiveRoadmap(studentId){
    const {data,error}=await sb.from('student_learning_roadmaps').select('*').eq('student_id',studentId).eq('status','active').order('updated_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data||null;
  }

  async function openLearningRoadmap(studentId){
    try{
      const st=(S.students||[]).find(x=>x.id===studentId);let existing=await getActiveRoadmap(studentId);let source=existing?.source_snapshot||{},slots=Array.isArray(existing?.plan)&&existing.plan.length?existing.plan:(await generateLearningRoadmap(studentId,4)).slots;
      if(!existing){const gen=await generateLearningRoadmap(studentId,4);slots=gen.slots;source=gen.source}
      const m=modal(`<div class="mr-card-head"><div><h2>План следующих 4 занятий</h2><p class="muted">${esc(st?.name||'Ученик')} · стратегический черновик, который можно менять вручную.</p></div><button class="btn" id="mrRoadmapRegenerate">↻ Пересобрать</button></div><div class="notice"><b>Логика:</b> Mathroom сочетает расписание, карту освоения, интервальное повторение, прошлые итоги и активные цели. Это подсказка преподавателю, а не автоматическое решение.</div><div class="mr-roadmap-grid" id="mrRoadmapGrid">${slots.map((x,i)=>roadmapCard(x,i,true)).join('')}</div><div class="actions"><button class="btn primary" id="mrRoadmapSave">Сохранить план</button><button class="btn" id="mrRoadmapApply">Применить к запланированным урокам</button></div>`, 'wide-modal');
      const paint=()=>{m.querySelector('#mrRoadmapGrid').innerHTML=slots.map((x,i)=>roadmapCard(x,i,true)).join('')};
      m.querySelector('#mrRoadmapRegenerate').onclick=async()=>{try{const gen=await generateLearningRoadmap(studentId,4);slots=gen.slots;source=gen.source;paint();toast('План пересобран по свежим данным')}catch(e){fail(e)}};
      m.querySelector('#mrRoadmapSave').onclick=async()=>{try{slots=readRoadmapModal(m,slots);existing=await saveRoadmap(studentId,slots,source,existing);document.querySelector('#mrRoadmapOverview')?.remove();await enhanceRoadmapOverview();toast('План на 4 занятия сохранён')}catch(e){fail(e)}};
      m.querySelector('#mrRoadmapApply').onclick=async()=>{try{slots=readRoadmapModal(m,slots);existing=await saveRoadmap(studentId,slots,source,existing);await applyRoadmapToLessons(studentId,slots)}catch(e){fail(e)}};
    }catch(e){fail(e)}
  }


  async function enhanceAttentionOverview(){
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrAttentionOverview'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const sid=S.selectedStudent, next=futureLessons(sid,1)[0]||null;
      const [review,mastery,goals,snoozes]=await Promise.all([
        getReviewQueue(sid,false),getTopicMastery(sid,false),getStudentGoals(sid,false),
        sb.from('student_alert_snoozes').select('*').eq('student_id',sid).then(x=>x.error?Promise.reject(x.error):x.data||[])
      ]);
      if(S.view!=='profile'||document.querySelector('#mrAttentionOverview'))return;
      const dataset={plans:[],queue:[],review,mastery,goals,snoozes};
      if(next){
        const [pr,qr]=await Promise.all([sb.from('lesson_plans').select('*').eq('lesson_id',next.id).maybeSingle(),sb.from('lesson_queue_items').select('id,lesson_id,status').eq('lesson_id',next.id)]);if(pr.error)throw pr.error;if(qr.error)throw qr.error;dataset.plans=pr.data?[pr.data]:[];dataset.queue=qr.data||[];
      }
      let alerts=prepAlertsForLesson(next||{id:'none',student_id:sid,scheduled_at:addDays(new Date(),7).toISOString()},dataset);
      if(!next&&!isSnoozed(dataset,sid,'lesson-not-scheduled'))alerts.unshift({key:'lesson-not-scheduled',severity:'info',title:'Следующее занятие не запланировано',detail:'Можно сначала определить дату, а затем собрать конкретный план урока.'});
      const box=document.createElement('div');box.id='mrAttentionOverview';box.className='card mr-attention-overview';box.innerHTML=`<div class="mr-card-head"><div><h2>Что нельзя упустить</h2><p class="small muted">Автоматические напоминания из ДЗ, повторения, целей и подготовки к следующему уроку.</p></div>${next?`<button class="btn sm primary" id="mrAttentionPrep">Подготовить урок</button>`:''}</div>${alerts.length?`<div class="mr-attention-profile-list">${alerts.slice(0,6).map(a=>`<div class="mr-attention-row ${a.severity}"><span class="pill ${alertPill(a.severity)}">${a.severity==='critical'?'Важно':a.severity==='warn'?'Внимание':'Учесть'}</span><div><b>${esc(a.title)}</b>${a.detail?`<small>${esc(a.detail)}</small>`:''}</div><button class="btn xs" data-profile-snooze="${esc(a.key)}">+7 дн</button></div>`).join('')}</div>`:'<div class="notice">По текущим данным срочных напоминаний нет.</div>'}`;
      const anchor=document.querySelector('#mrSmartPrep')||document.querySelector('#mrGoalsOverview');anchor?.insertAdjacentElement('afterend',box);
      box.querySelector('#mrAttentionPrep')?.addEventListener('click',()=>openLessonPreparation(next.id));
      box.querySelectorAll('[data-profile-snooze]').forEach(b=>b.onclick=async()=>{try{await snoozeStudentAlert(sid,b.dataset.profileSnooze,7);box.remove();await enhanceAttentionOverview();toast('Напоминание скрыто на 7 дней')}catch(e){fail(e)}});
    }catch(e){console.warn('[Mathroom attention]',e)}
  }

  async function enhanceRoadmapOverview(){
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrRoadmapOverview'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{const roadmap=await getActiveRoadmap(S.selectedStudent);if(S.view!=='profile'||document.querySelector('#mrRoadmapOverview'))return;const slots=Array.isArray(roadmap?.plan)?roadmap.plan:[];const box=document.createElement('div');box.id='mrRoadmapOverview';box.className='card mr-roadmap-overview';box.innerHTML=`<div class="mr-card-head"><div><h2>План следующих 4 занятий</h2><p class="small muted">Не только ближайший урок: последовательность повторения, закрепления и самостоятельности.</p></div><button class="btn sm primary" id="mrRoadmapOpen">${slots.length?'Открыть план':'Сформировать'}</button></div>${slots.length?`<div class="mr-roadmap-mini">${slots.slice(0,4).map((x,i)=>roadmapCard(x,i,false)).join('')}</div>`:'<div class="empty">План ещё не сформирован. Mathroom может собрать черновик из карты освоения и расписания.</div>'}`;const anchor=document.querySelector('#mrSmartPrep')||document.querySelector('#mrMasteryOverview')||document.querySelector('#mrGoalsOverview');anchor?.insertAdjacentElement('afterend',box);box.querySelector('#mrRoadmapOpen').onclick=()=>openLearningRoadmap(S.selectedStudent)}catch(e){console.warn('[Mathroom roadmap]',e)}
  }

  async function openPreparationCenterModal(){
    try{const d=await loadPrepDataset(true);const m=modal(`<div class="mr-card-head"><div><h2>Центр подготовки</h2><p class="muted">Ближайшие занятия и всё, что стоит закрыть до их начала.</p></div><span class="pill">${d.lessons.length} ближайших</span></div><div class="mr-prep-center-list">${d.lessons.length?d.lessons.map(l=>{const st=lessonStudent(l),topic=lessonTopic(l),plan=d.plans.find(x=>x.lesson_id===l.id),q=d.queue.filter(x=>x.lesson_id===l.id).length,alerts=prepAlertsForLesson(l,d);return`<div class="mr-prep-lesson"><div class="mr-prep-time">${esc(compactWhen(l.scheduled_at))}</div><div><b>${esc(st?.name||'Ученик')} · ${esc(topic?.title||'Без темы')}</b><small>${plan?.main_goal?esc(plan.main_goal):'Цель урока ещё не заполнена'} · ${q} задач</small><div class="mr-alert-chips">${alerts.slice(0,3).map(a=>`<span class="pill ${alertPill(a.severity)}">${esc(a.title)}</span>`).join('')||'<span class="pill good">Без срочных хвостов</span>'}</div></div><button class="btn sm ${plan?.prep_status==='ready'?'':'primary'}" data-open-prep="${l.id}">${plan?.prep_status==='ready'?'Проверить':'Подготовить'}</button></div>`}).join(''):'<div class="empty">Нет ближайших запланированных уроков.</div>'}</div>`, 'wide-modal');m.querySelectorAll('[data-open-prep]').forEach(b=>b.onclick=()=>{m.remove();openLessonPreparation(b.dataset.openPrep)})}catch(e){fail(e)}
  }

  async function enhancePreparationCenter(){
    if(S.access||S.view!=='dashboard'||document.querySelector('#mrPreparationCenter')||prepCenterBusy)return;const content=document.querySelector('.content');if(!content)return;prepCenterBusy=true;
    try{const d=await loadPrepDataset();if(S.view!=='dashboard'||document.querySelector('#mrPreparationCenter'))return;const near=d.lessons.filter(x=>new Date(x.scheduled_at).getTime()-Date.now()<=48*3600000);const allAlerts=d.lessons.flatMap(l=>prepAlertsForLesson(l,d));const critical=allAlerts.filter(x=>x.severity==='critical').length;const ready=d.lessons.filter(l=>d.plans.find(p=>p.lesson_id===l.id)?.prep_status==='ready').length;const box=document.createElement('div');box.id='mrPreparationCenter';box.className='card mr-prep-center';box.innerHTML=`<div class="mr-card-head"><div><h2>Центр подготовки</h2><p class="small muted">Ближайшие уроки, хвосты и готовность материалов в одном месте.</p></div><button class="btn sm primary" id="mrPrepCenterOpen">Открыть центр</button></div><div class="mr-smart-metrics"><span><b>${near.length}</b><small>в ближайшие 48 ч</small></span><span><b>${ready}</b><small>отмечено готовыми</small></span><span><b>${critical}</b><small>важно закрыть</small></span><span><b>${allAlerts.length}</b><small>всего напоминаний</small></span></div><div class="mr-prep-center-list compact">${d.lessons.slice(0,4).map(l=>{const st=lessonStudent(l),p=d.plans.find(x=>x.lesson_id===l.id),alerts=prepAlertsForLesson(l,d);return`<button class="mr-prep-compact-row" data-open-prep="${l.id}"><span>${esc(compactWhen(l.scheduled_at))}</span><b>${esc(st?.name||'Ученик')}</b><em>${alerts[0]?esc(alerts[0].title):(p?.prep_status==='ready'?'Готово':'Проверить подготовку')}</em><i class="${p?.prep_status==='ready'?'ready':''}"></i></button>`}).join('')}</div>`;const grid=content.querySelector('.grid.cols4');if(grid)grid.insertAdjacentElement('afterend',box);else content.prepend(box);box.querySelector('#mrPrepCenterOpen').onclick=openPreparationCenterModal;box.querySelectorAll('[data-open-prep]').forEach(b=>b.onclick=()=>openLessonPreparation(b.dataset.openPrep))}catch(e){console.warn('[Mathroom prep center]',e)}finally{prepCenterBusy=false}
  }



  // ---- Cumulative WIP: diagnostics + readiness + progress snapshots ----
  const SNAPSHOT_INTERVAL_MS = 6 * 86400000;

  function scoreBand(score) {
    if (score == null || !Number.isFinite(Number(score))) return {key:'no_data', label:'Нет данных'};
    const n=Number(score);
    if(n>=85)return{key:'good',label:'Уверенно'};
    if(n>=70)return{key:'ok',label:'Стабильно'};
    if(n>=50)return{key:'warn',label:'Нужно закрепить'};
    return{key:'danger',label:'Зона внимания'};
  }

  function topicSnapshotPayload(rows) {
    return (rows||[]).map(r=>({
      topic_id:r.topic_id,
      title:r.topics?.title||'', section:r.topics?.section||'', grade:r.topics?.grade??null,
      mastery:r.mastery==null?null:Math.round(Number(r.mastery)), status:masteryStatus(r.mastery,r.evidence_count).key,
      evidence_count:Number(r.evidence_count||0), lesson_score:r.lesson_score, homework_score:r.homework_score,
      test_score:r.test_score, review_score:r.review_score, trend:r.trend
    }));
  }

  function snapshotSummary(rows) {
    const known=(rows||[]).filter(r=>r.mastery!=null&&Number.isFinite(Number(r.mastery)));
    const states=(rows||[]).map(r=>masteryStatus(r.mastery,r.evidence_count).key);
    return {
      overall_mastery:meanSafe(known.map(r=>r.mastery)), known_topics:known.length,
      mastered_count:states.filter(x=>x==='mastered').length,
      confident_count:states.filter(x=>x==='confident').length,
      working_count:states.filter(x=>x==='working').length,
      attention_count:states.filter(x=>x==='attention').length,
      no_data_count:states.filter(x=>x==='no_data').length
    };
  }

  async function getProgressSnapshots(studentId, limit=24) {
    const {data,error}=await sb.from('student_progress_snapshots').select('*').eq('student_id',studentId).order('created_at',{ascending:false}).limit(limit);
    if(error)throw error; return data||[];
  }

  async function saveProgressSnapshot(studentId, source='weekly', force=false) {
    const recent=await getProgressSnapshots(studentId,1);
    if(!force&&recent[0]&&Date.now()-new Date(recent[0].created_at).getTime()<SNAPSHOT_INTERVAL_MS)return recent[0];
    const rows=await getTopicMastery(studentId,true), summary=snapshotSummary(rows);
    const reportsR=await sb.from('lesson_reports').select('solved_percent,created_at').eq('student_id',studentId).order('created_at',{ascending:false}).limit(8);
    if(reportsR.error)throw reportsR.error;
    const hw=(S.homeworks||[]).filter(x=>x.student_id===studentId&&x.score!=null&&['submitted','reviewed'].includes(x.status));
    const tests=(S.tests||[]).filter(x=>x.student_id===studentId&&x.score!=null&&x.status==='submitted');
    const payload={teacher_id:S.user.id,student_id:studentId,source,
      ...summary,
      lesson_avg:meanSafe((reportsR.data||[]).map(x=>x.solved_percent)), homework_avg:meanSafe(hw.map(x=>x.score)), test_avg:meanSafe(tests.map(x=>x.score)),
      topic_snapshot:topicSnapshotPayload(rows), created_at:new Date().toISOString()};
    const {data,error}=await sb.from('student_progress_snapshots').insert(payload).select().single();if(error)throw error;return data;
  }

  function snapshotChartHtml(snapshots) {
    const xs=[...(snapshots||[])].reverse().filter(x=>x.overall_mastery!=null).slice(-12);
    if(!xs.length)return'<div class="empty">История появится после первого сохранённого среза.</div>';
    return `<div class="mr-snapshot-chart">${xs.map(x=>{const p=Math.max(0,Math.min(100,Number(x.overall_mastery)));return`<div class="mr-snapshot-col" title="${new Date(x.created_at).toLocaleDateString('ru-RU')} · ${Math.round(p)}%"><span>${Math.round(p)}%</span><div><i style="height:${Math.max(4,p)}%"></i></div><small>${new Date(x.created_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</small></div>`}).join('')}</div>`;
  }

  function nearestSnapshot(snapshots, daysAgo) {
    const target=Date.now()-daysAgo*86400000;
    const xs=(snapshots||[]).filter(x=>new Date(x.created_at).getTime()<=Date.now());
    return xs.length?[...xs].sort((a,b)=>Math.abs(new Date(a.created_at).getTime()-target)-Math.abs(new Date(b.created_at).getTime()-target))[0]:null;
  }

  function snapshotDiffHtml(latest, previous) {
    if(!latest)return'<div class="empty">Нет сохранённых срезов.</div>';
    const diff=(a,b)=>a==null||b==null?null:Math.round(Number(a)-Number(b));
    const delta=diff(latest.overall_mastery,previous?.overall_mastery);
    const mastered=diff(latest.mastered_count,previous?.mastered_count);
    const attention=diff(latest.attention_count,previous?.attention_count);
    const d=v=>v==null?'—':`${v>0?'+':''}${v}`;
    return `<div class="mr-compare-metrics"><span><small>Сейчас</small><b>${latest.overall_mastery==null?'—':Math.round(Number(latest.overall_mastery))+'%'}</b></span><span><small>Изменение</small><b class="${delta>0?'good':delta<0?'warn':''}">${d(delta)}${delta!=null?' п.п.':''}</b></span><span><small>Освоено тем</small><b class="${mastered>0?'good':mastered<0?'warn':''}">${latest.mastered_count||0}${previous?` · ${d(mastered)}`:''}</b></span><span><small>Требуют внимания</small><b class="${attention<0?'good':attention>0?'warn':''}">${latest.attention_count||0}${previous?` · ${d(attention)}`:''}</b></span></div>`;
  }

  async function openProgressComparison(studentId) {
    try{
      await saveProgressSnapshot(studentId,'manual-open',false);
      let snapshots=await getProgressSnapshots(studentId,30), latest=snapshots[0], previous=nearestSnapshot(snapshots,30);
      if(previous?.id===latest?.id)previous=snapshots.find(x=>x.id!==latest?.id)||null;
      const st=(S.students||[]).find(x=>x.id===studentId);
      const m=modal(`<div class="mr-card-head"><div><h2>Прогресс во времени</h2><p class="muted">${esc(st?.name||'Ученик')} · сравнение сохранённых учебных срезов.</p></div><button class="btn sm primary" id="mrSaveSnapshotNow">Зафиксировать сейчас</button></div><div id="mrCompareBody"></div><div class="notice"><b>Как читать:</b> это история фактических учебных данных Mathroom. Она показывает изменение карты тем, а не прогнозирует оценку сама по себе.</div>`,'wide-modal');
      const paint=()=>{latest=snapshots[0];previous=nearestSnapshot(snapshots,30);if(previous?.id===latest?.id)previous=snapshots.find(x=>x.id!==latest?.id)||null;const latestTopics=new Map((latest?.topic_snapshot||[]).map(x=>[x.topic_id,x])),prevTopics=new Map((previous?.topic_snapshot||[]).map(x=>[x.topic_id,x]));const changes=[...latestTopics.values()].filter(x=>x.mastery!=null&&prevTopics.get(x.topic_id)?.mastery!=null).map(x=>({...x,delta:Number(x.mastery)-Number(prevTopics.get(x.topic_id).mastery)})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,10);m.querySelector('#mrCompareBody').innerHTML=`${snapshotDiffHtml(latest,previous)}${snapshotChartHtml(snapshots)}${previous?`<div class="small muted" style="margin:8px 0 12px">Сравнение: ${new Date(previous.created_at).toLocaleDateString('ru-RU')} → ${new Date(latest.created_at).toLocaleDateString('ru-RU')}</div>`:'<div class="small muted" style="margin:8px 0 12px">Нужен ещё один срез в будущем, чтобы показать изменение.</div>'}${changes.length?`<div class="mr-topic-diff-list">${changes.map(x=>`<div><span><b>${esc(x.title||'Тема')}</b><small>${esc(x.section||'')}</small></span><em class="${x.delta>0?'good':x.delta<0?'warn':''}">${x.delta>0?'↑':x.delta<0?'↓':'→'} ${Math.abs(Math.round(x.delta))} п.п.</em><span>${prevTopics.get(x.topic_id).mastery}% → <b>${x.mastery}%</b></span></div>`).join('')}</div>`:''}`};
      m.querySelector('#mrSaveSnapshotNow').onclick=async()=>{try{await saveProgressSnapshot(studentId,'manual',true);snapshots=await getProgressSnapshots(studentId,30);paint();toast('Срез прогресса сохранён')}catch(e){fail(e)}};paint();
    }catch(e){fail(e)}
  }

  function readinessForTarget(target, rows) {
    const ids=new Set(target.topic_ids||[]), selected=(rows||[]).filter(r=>ids.has(r.topic_id));
    const known=selected.filter(r=>r.mastery!=null&&Number.isFinite(Number(r.mastery)));
    const average=meanSafe(known.map(r=>r.mastery)), coverage=selected.length?Math.round(known.length*100/selected.length):0;
    const evidence=known.length?Math.round(known.reduce((s,r)=>s+Number(r.evidence_count||0),0)/known.length):0;
    const weakest=[...known].sort((a,b)=>Number(a.mastery)-Number(b.mastery)).slice(0,3);
    const targetPct=Number(target.target_percent||80), gap=average==null?null:Math.round(average-targetPct);
    return {selected,known,average,coverage,evidence,weakest,targetPct,gap};
  }

  async function getReadinessTargets(studentId) {
    const {data,error}=await sb.from('student_readiness_targets').select('*').eq('student_id',studentId).neq('status','archived').order('target_date',{ascending:true,nullsFirst:false});if(error)throw error;return data||[];
  }

  function readinessCard(target, metric) {
    const band=scoreBand(metric.average), days=target.target_date?Math.ceil((new Date(`${target.target_date}T23:59:59`).getTime()-Date.now())/86400000):null;
    return `<div class="mr-readiness-card"><div class="mr-readiness-head"><div><span class="pill">${target.kind==='exam'?'Экзамен':target.kind==='control'?'Контрольная':'Контрольная точка'}</span><h3>${esc(target.title)}</h3></div><b>${metric.average==null?'—':metric.average+'%'}</b></div><div class="mr-readiness-bar"><i style="width:${metric.average==null?0:Math.max(2,Math.min(100,metric.average))}%"></i><mark style="left:${Math.max(0,Math.min(100,metric.targetPct))}%"></mark></div><div class="mr-readiness-meta"><span>${band.label}</span><span>цель ${metric.targetPct}%</span><span>данные ${metric.coverage}% тем</span>${days!=null?`<span>${days<0?'срок прошёл':days===0?'сегодня':`через ${days} дн.`}</span>`:''}</div>${metric.weakest.length?`<div class="small muted">Фокус: ${metric.weakest.map(x=>`${esc(x.topics?.title||'Тема')} ${Math.round(Number(x.mastery))}%`).join(' · ')}</div>`:''}<div class="actions"><button class="btn xs" data-readiness-edit="${target.id}">Изменить</button><button class="btn xs" data-readiness-diagnostic="${target.id}">Создать срез</button><button class="btn xs primary" data-readiness-plan="${target.id}">План до даты</button></div></div>`;
  }

  async function openReadinessEditor(studentId, rows, target=null) {
    const st=(S.students||[]).find(x=>x.id===studentId), selected=new Set(target?.topic_ids||[]), topics=(rows||[]).filter(x=>x.topics);
    if(!selected.size)topics.filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery)).slice(0,5).forEach(x=>selected.add(x.topic_id));
    const m=modal(`<h2>${target?'Изменить цель':'Новая цель готовности'}</h2><p class="muted">Выбери темы, по которым Mathroom будет собирать прозрачный показатель текущей готовности.</p><div class="grid cols2"><div class="field"><label>Название</label><input id="mrReadyTitle" value="${esc(target?.title||'')}" placeholder="Например: Контрольная по алгебре"></div><div class="field"><label>Тип</label><select id="mrReadyKind"><option value="checkpoint">Контрольная точка</option><option value="control">Контрольная</option><option value="exam">Экзамен</option></select></div></div><div class="grid cols2"><div class="field"><label>Дата</label><input id="mrReadyDate" type="date" value="${esc(target?.target_date||'')}"></div><div class="field"><label>Целевой уровень, %</label><input id="mrReadyPercent" type="number" min="1" max="100" value="${Number(target?.target_percent||80)}"></div></div><div class="field"><label>Обязательные темы цели</label><div class="mr-target-topic-list">${topics.map(r=>`<label><input type="checkbox" data-ready-topic="${r.topic_id}" ${selected.has(r.topic_id)?'checked':''}><span><b>${esc(r.topics?.title||'Тема')}</b><small>${esc(r.topics?.section||'')} · ${r.mastery==null?'нет данных':Math.round(Number(r.mastery))+'%'}</small></span></label>`).join('')}</div></div><div class="field"><label>Приватная заметка преподавателя</label><textarea id="mrReadyNote">${esc(target?.teacher_note||'')}</textarea></div><div class="actions"><button class="btn primary" id="mrReadySave">Сохранить</button>${target?'<button class="btn danger" id="mrReadyArchive">Архивировать</button>':''}</div>`,'wide-modal');
    m.querySelector('#mrReadyKind').value=target?.kind||'checkpoint';
    m.querySelector('#mrReadySave').onclick=async()=>{try{const ids=[...m.querySelectorAll('[data-ready-topic]:checked')].map(x=>x.dataset.readyTopic);if(!ids.length)return toast('Выбери хотя бы одну тему');const body={teacher_id:S.user.id,student_id:studentId,title:m.querySelector('#mrReadyTitle').value.trim()||'Учебная цель',kind:m.querySelector('#mrReadyKind').value,target_date:m.querySelector('#mrReadyDate').value||null,target_percent:Math.max(1,Math.min(100,Number(m.querySelector('#mrReadyPercent').value||80))),topic_ids:ids,teacher_note:m.querySelector('#mrReadyNote').value.trim(),status:'active',updated_at:new Date().toISOString()};let q=target?sb.from('student_readiness_targets').update(body).eq('id',target.id):sb.from('student_readiness_targets').insert(body);const {error}=await q;if(error)throw error;m.remove();document.querySelector('#mrLearningIntelligence')?.remove();await enhanceLearningIntelligence();toast('Цель готовности сохранена')}catch(e){fail(e)}};
    m.querySelector('#mrReadyArchive')?.addEventListener('click',async()=>{try{const{error}=await sb.from('student_readiness_targets').update({status:'archived',updated_at:new Date().toISOString()}).eq('id',target.id);if(error)throw error;m.remove();document.querySelector('#mrLearningIntelligence')?.remove();await enhanceLearningIntelligence()}catch(e){fail(e)}});
  }

  async function openReadinessCenter(studentId, providedRows=null) {
    try {
      const rows=providedRows||await getTopicMastery(studentId,true);
      const targets=await getReadinessTargets(studentId);
      const st=(S.students||[]).find(x=>x.id===studentId);
      const m=modal(`<div class="mr-card-head"><div><h2>Готовность к контрольным целям</h2><p class="muted">${esc(st?.name||'Ученик')} · текущие данные по выбранным темам.</p></div><button class="btn sm primary" id="mrReadyAdd">+ Цель</button></div><div class="notice"><b>Важно:</b> показатель «готовность по данным» не является вероятностью оценки. Он показывает среднее освоение выбранных тем и отдельно — насколько они покрыты наблюдениями.</div><div class="mr-readiness-list">${targets.length?targets.map(t=>readinessCard(t,readinessForTarget(t,rows))).join(''):'<div class="empty">Добавь контрольную, экзамен или другую учебную точку.</div>'}</div>`,'wide-modal');
      m.querySelector('#mrReadyAdd').onclick=()=>openReadinessEditor(studentId,rows);
      m.querySelectorAll('[data-readiness-edit]').forEach(b=>{
        b.onclick=()=>openReadinessEditor(studentId,rows,targets.find(x=>x.id===b.dataset.readinessEdit));
      });
      m.querySelectorAll('[data-readiness-diagnostic]').forEach(b=>{
        b.onclick=()=>{
          const t=targets.find(x=>x.id===b.dataset.readinessDiagnostic);
          openDiagnosticCreator(studentId,rows,t?.topic_ids||[],`Диагностика · ${t?.title||'контрольная цель'}`);
        };
      });
      m.querySelectorAll('[data-readiness-plan]').forEach(b=>{
        b.onclick=()=>{const t=targets.find(x=>x.id===b.dataset.readinessPlan);if(t)openTargetTrajectory(studentId,t,rows)};
      });
    } catch(e) { fail(e); }
  }

  function balancedDiagnosticTasks(topicIds,count) {
    const groups=topicIds.map(id=>shuffle((S.exercises||[]).filter(x=>x.topic_id===id&&x.kind==='task'&&String(x.answer||'').trim()).sort((a,b)=>Number(a.use_count||0)-Number(b.use_count||0))));
    const picked=[],used=new Set();let guard=0;
    while(picked.length<count&&groups.some(g=>g.length)&&guard++<100){for(const g of groups){while(g.length&&used.has(g[0].id))g.shift();if(g.length&&picked.length<count){const x=g.shift();used.add(x.id);picked.push(x)}}}
    return picked;
  }

  async function diagnosticMasterySnapshot(rows,topicIds) {
    const ids=new Set(topicIds);return (rows||[]).filter(x=>ids.has(x.topic_id)).map(x=>({topic_id:x.topic_id,title:x.topics?.title||'',mastery:x.mastery,evidence_count:x.evidence_count||0}));
  }

  async function openDiagnosticCreator(studentId, providedRows=null, presetIds=[], presetTitle='') {
    try{const rows=providedRows||await getTopicMastery(studentId,true),selected=new Set(presetIds),st=(S.students||[]).find(x=>x.id===studentId);if(!selected.size)rows.filter(x=>x.mastery!=null).sort((a,b)=>Number(a.mastery)-Number(b.mastery)).slice(0,4).forEach(x=>selected.add(x.topic_id));const defaultTitle=presetTitle||`Диагностический срез · ${new Date().toLocaleDateString('ru-RU')}`;const m=modal(`<h2>Новый диагностический срез</h2><p class="muted">${esc(st?.name||'Ученик')} · Mathroom соберёт сбалансированный мини-тест из твоего банка задач.</p><div class="grid cols2"><div class="field"><label>Название</label><input id="mrDiagTitle" value="${esc(defaultTitle)}"></div><div class="field"><label>Количество задач</label><select id="mrDiagCount"><option>4</option><option>6</option><option selected>8</option><option>10</option><option>12</option></select></div></div><div class="field"><label>Темы среза</label><div class="mr-target-topic-list">${rows.map(r=>`<label><input type="checkbox" data-diag-topic="${r.topic_id}" ${selected.has(r.topic_id)?'checked':''}><span><b>${esc(r.topics?.title||'Тема')}</b><small>${esc(r.topics?.section||'')} · ${r.mastery==null?'нет данных':Math.round(Number(r.mastery))+'%'} · задач в банке ${(S.exercises||[]).filter(e=>e.topic_id===r.topic_id&&e.kind==='task'&&String(e.answer||'').trim()).length}</small></span></label>`).join('')}</div></div><div class="field"><label>Комментарий преподавателя</label><textarea id="mrDiagNote" placeholder="Например: входной срез перед блоком"></textarea></div><div id="mrDiagPreview" class="notice">Выбери темы — Mathroom проверит, хватает ли задач.</div><button class="btn primary" id="mrDiagCreate">Назначить диагностику</button>`,'wide-modal');const preview=()=>{const ids=[...m.querySelectorAll('[data-diag-topic]:checked')].map(x=>x.dataset.diagTopic),count=Number(m.querySelector('#mrDiagCount').value),tasks=balancedDiagnosticTasks(ids,count);m.querySelector('#mrDiagPreview').innerHTML=`Выбрано тем: <b>${ids.length}</b> · доступно для среза: <b>${tasks.length}/${count}</b> задач${tasks.length<count?'<br><span class="warn">В выбранных темах не хватает задач с заполненными ответами.</span>':''}`};m.querySelectorAll('[data-diag-topic]').forEach(x=>x.onchange=preview);m.querySelector('#mrDiagCount').onchange=preview;preview();m.querySelector('#mrDiagCreate').onclick=async()=>{try{const ids=[...m.querySelectorAll('[data-diag-topic]:checked')].map(x=>x.dataset.diagTopic),count=Number(m.querySelector('#mrDiagCount').value),tasks=balancedDiagnosticTasks(ids,count);if(!ids.length)return toast('Выбери хотя бы одну тему');if(tasks.length<count)return toast(`Нужно ещё ${count-tasks.length} задач с ответами`);const baseline=await diagnosticMasterySnapshot(rows,ids);const oneTopic=ids.length===1?ids[0]:null;const body={teacher_id:S.user.id,student_id:studentId,topic_id:oneTopic,title:m.querySelector('#mrDiagTitle').value.trim()||'Диагностический срез',source:'diagnostic',diagnostic_topic_ids:ids,diagnostic_note:m.querySelector('#mrDiagNote').value.trim(),diagnostic_snapshot:{created_at:new Date().toISOString(),topics:baseline}};const{data:test,error}=await sb.from('tests').insert(body).select().single();if(error)throw error;const items=tasks.map((x,i)=>({test_id:test.id,prompt:x.content,correct_answer:x.answer,position:i,source_exercise_id:x.id,difficulty:x.difficulty,category:x.category||'',tags:x.tags||[]}));const{error:itemErr}=await sb.from('test_items').insert(items);if(itemErr)throw itemErr;S.tests=[{...test,students:{name:st?.name||'',grade:st?.grade||null},topics:oneTopic?{title:(S.topics||[]).find(t=>t.id===oneTopic)?.title||''}:null},...(S.tests||[])];m.remove();toast('Диагностический срез назначен');document.querySelector('#mrLearningIntelligence')?.remove();await enhanceLearningIntelligence()}catch(e){fail(e)}};
    }catch(e){fail(e)}
  }

  async function openDiagnosticResult(test) {
    try{const{data:items,error}=await sb.from('test_items').select('*').eq('test_id',test.id).order('position');if(error)throw error;const topicNames=(test.diagnostic_topic_ids||[]).map(id=>(S.topics||[]).find(t=>t.id===id)?.title).filter(Boolean);const baseline=meanSafe((test.diagnostic_snapshot?.topics||[]).map(x=>x.mastery));modal(`<div class="mr-card-head"><div><h2>${esc(test.title)}</h2><p class="muted">${topicNames.map(esc).join(' · ')||'Диагностический срез'}</p></div><span class="pill ${test.status==='submitted'?'good':'warn'}">${test.status==='submitted'?`Результат ${Math.round(Number(test.score||0))}%`:'Ожидает выполнения'}</span></div><div class="mr-compare-metrics"><span><small>Задач</small><b>${(items||[]).length}</b></span><span><small>Карта тем при назначении</small><b>${baseline==null?'—':baseline+'%'}</b></span><span><small>Результат среза</small><b>${test.score==null?'—':Math.round(Number(test.score))+'%'}</b></span><span><small>Статус</small><b>${test.status==='submitted'?'Готов':'Назначен'}</b></span></div>${test.diagnostic_note?`<div class="notice">${nl(test.diagnostic_note)}</div>`:''}<div class="answers">${(items||[]).map((x,i)=>`<div class="answer-item ${x.is_correct===true?'correct':x.is_correct===false?'wrong':''}"><b>${i+1}. ${esc(x.prompt)}</b>${test.status==='submitted'?`<div class="small">Ответ ученика: <b>${esc(x.student_answer||'—')}</b> · ${x.is_correct?'✓ верно':'✕ ошибка'}</div><div class="small muted">Правильный: ${esc(x.correct_answer||'—')}</div>`:''}</div>`).join('')}</div>`,'wide-modal') }catch(e){fail(e)}
  }

  async function openDiagnosticCenter(studentId, providedRows=null) {
    try{const rows=providedRows||await getTopicMastery(studentId,true),tests=(S.tests||[]).filter(x=>x.student_id===studentId&&x.source==='diagnostic').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),st=(S.students||[]).find(x=>x.id===studentId);const m=modal(`<div class="mr-card-head"><div><h2>Диагностические срезы</h2><p class="muted">${esc(st?.name||'Ученик')} · короткие измерения по выбранным темам.</p></div><button class="btn sm primary" id="mrDiagAdd">+ Новый срез</button></div><div class="mr-diagnostic-list">${tests.length?tests.map(t=>{const names=(t.diagnostic_topic_ids||[]).map(id=>(S.topics||[]).find(x=>x.id===id)?.title).filter(Boolean);return`<button class="mr-diagnostic-row" data-diag-open="${t.id}"><span><b>${esc(t.title)}</b><small>${new Date(t.created_at).toLocaleDateString('ru-RU')} · ${names.slice(0,3).map(esc).join(' · ')||'темы курса'}</small></span><em class="pill ${t.status==='submitted'?'good':'warn'}">${t.status==='submitted'?`${Math.round(Number(t.score||0))}%`:'назначен'}</em></button>`}).join(''):'<div class="empty">Диагностических срезов пока нет.</div>'}</div>`,'wide-modal');m.querySelector('#mrDiagAdd').onclick=()=>openDiagnosticCreator(studentId,rows);m.querySelectorAll('[data-diag-open]').forEach(b=>b.onclick=()=>openDiagnosticResult(tests.find(x=>x.id===b.dataset.diagOpen)))}catch(e){fail(e)}
  }

  async function enhanceLearningIntelligence() {
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrLearningIntelligence'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const studentId=S.selectedStudent;
      await saveProgressSnapshot(studentId,'weekly',false);
      const [rows,snapshots,targets]=await Promise.all([getTopicMastery(studentId,false),getProgressSnapshots(studentId,16),getReadinessTargets(studentId)]);
      if(S.view!=='profile'||S.selectedStudent!==studentId||document.querySelector('#mrLearningIntelligence'))return;
      const latest=snapshots[0],prev=nearestSnapshot(snapshots,30);const prevReal=prev?.id===latest?.id?snapshots.find(x=>x.id!==latest?.id):prev;
      const active=targets.filter(x=>x.status==='active'),ready=active[0]?readinessForTarget(active[0],rows):null;
      const diagnostics=(S.tests||[]).filter(x=>x.student_id===studentId&&x.source==='diagnostic');const completed=diagnostics.filter(x=>x.status==='submitted');
      const box=document.createElement('div');box.id='mrLearningIntelligence';box.className='card mr-learning-intelligence';box.innerHTML=`<div class="mr-card-head"><div><h2>Диагностика и готовность</h2><p class="small muted">Срезы, изменение прогресса и подготовка к контрольным целям.</p></div><div class="actions"><button class="btn sm" id="mrProgressCompare">Прогресс во времени</button><button class="btn sm" id="mrDiagnosticsOpen">Диагностика</button><button class="btn sm primary" id="mrReadinessOpen">Готовность</button></div></div><div class="mr-intelligence-grid"><div><small>Общее освоение</small><b>${latest?.overall_mastery==null?'—':Math.round(Number(latest.overall_mastery))+'%'}</b><span>${prevReal&&latest?.overall_mastery!=null&&prevReal.overall_mastery!=null?`${Number(latest.overall_mastery)-Number(prevReal.overall_mastery)>=0?'↑':'↓'} ${Math.abs(Math.round(Number(latest.overall_mastery)-Number(prevReal.overall_mastery)))} п.п. к прошлому срезу`:'накапливаем историю'}</span></div><div><small>Диагностик</small><b>${completed.length}/${diagnostics.length}</b><span>${completed[0]?`последняя ${Math.round(Number(completed.sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)))[0].score||0))}%`:'нет выполненных'}</span></div><div><small>Контрольных целей</small><b>${active.length}</b><span>${ready?`первая: ${ready.average==null?'—':ready.average+'%'} · данные ${ready.coverage}%`:'добавь цель'}</span></div></div>${active[0]?`<div class="mr-intelligence-focus"><b>${esc(active[0].title)}</b><span>${ready.average==null?'Нет достаточных данных':`Готовность по данным ${ready.average}% · целевой уровень ${ready.targetPct}% · покрытие ${ready.coverage}%`}</span></div>`:''}`;
      const anchor=document.querySelector('#mrMasteryOverview')||document.querySelector('#mrRoadmapOverview')||document.querySelector('#mrSmartPrep')||document.querySelector('#mrGoalsOverview');anchor?.insertAdjacentElement('afterend',box);box.querySelector('#mrProgressCompare').onclick=()=>openProgressComparison(studentId);box.querySelector('#mrDiagnosticsOpen').onclick=()=>openDiagnosticCenter(studentId,rows);box.querySelector('#mrReadinessOpen').onclick=()=>openReadinessCenter(studentId,rows);
    }catch(e){console.warn('[Mathroom learning intelligence]',e)}
  }

  // ---- Cumulative WIP: target trajectory to date + adaptive 4-lesson planning ----
  const TARGET_PLAN_MAX_LESSONS = 16;

  function targetDaysLeft(target) {
    if (!target?.target_date) return null;
    return Math.ceil((new Date(`${target.target_date}T23:59:59`).getTime() - Date.now()) / 86400000);
  }

  function targetLessonsUntil(studentId, targetDate, limit = TARGET_PLAN_MAX_LESSONS) {
    const end = targetDate ? new Date(`${targetDate}T23:59:59`).getTime() : Infinity;
    return (S.lessons || [])
      .filter(x => x.student_id === studentId && x.status === 'assigned' && x.scheduled_at && new Date(x.scheduled_at).getTime() >= Date.now() && new Date(x.scheduled_at).getTime() <= end)
      .sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .slice(0, limit);
  }

  function targetTopicRows(target, rows) {
    const by = new Map((rows || []).map(x => [String(x.topic_id), x]));
    return (target?.topic_ids || []).map(id => {
      const row = by.get(String(id));
      if (row) return row;
      const topic = (S.topics || []).find(x => String(x.id) === String(id));
      return { topic_id:id, topics:topic || { title:'Тема', section:'' }, mastery:null, evidence_count:0, trend:null };
    });
  }

  function targetTopicPriority(row, targetPct) {
    const mastery = row.mastery == null ? null : Number(row.mastery);
    const evidence = Number(row.evidence_count || 0);
    const trend = Number(row.trend || 0);
    const gap = mastery == null ? targetPct : Math.max(0, targetPct - mastery);
    return Math.round(gap * 2 + (mastery == null ? 35 : 0) + (evidence < 2 ? 18 : evidence < 4 ? 8 : 0) + (trend < 0 ? Math.min(18, Math.abs(trend)) : 0));
  }

  function targetTaskCount(topicId) {
    return (S.exercises || []).filter(x => String(x.topic_id) === String(topicId) && x.kind === 'task').length;
  }

  function targetFingerprint(target, selected, lessons) {
    return JSON.stringify({
      target_id: target.id,
      target_date: target.target_date || null,
      target_percent: Number(target.target_percent || 80),
      topics: selected.map(x => [x.topic_id, x.mastery == null ? null : Math.round(Number(x.mastery)), Number(x.evidence_count || 0), x.trend == null ? null : Math.round(Number(x.trend))]),
      lessons: lessons.map(x => [x.id, x.scheduled_at, x.topic_id || null])
    });
  }

  function targetTempo(existing, selected, targetPct) {
    const src = existing?.source_snapshot || {};
    if (src.baseline_average == null || !Array.isArray(src.scheduled_dates) || !src.scheduled_dates.length) return null;
    const current = meanSafe(selected.map(x => x.mastery));
    if (current == null) return null;
    const baseline = Number(src.baseline_average);
    const dates = src.scheduled_dates.map(x => new Date(x).getTime()).filter(Number.isFinite).sort((a,b)=>a-b);
    const elapsed = dates.filter(x => x < Date.now()).length;
    if (!elapsed) return { key:'new', label:'План только начат', actual:0, expected:0 };
    const expected = Math.max(0, Number(targetPct) - baseline) * Math.min(1, elapsed / dates.length);
    const actual = current - baseline;
    const deviation = actual - expected;
    if (deviation >= 6) return { key:'ahead', label:'Темп выше исходного плана', actual:Math.round(actual), expected:Math.round(expected) };
    if (deviation <= -6) return { key:'behind', label:'Нужно перераспределить фокус', actual:Math.round(actual), expected:Math.round(expected) };
    return { key:'ontrack', label:'Темп близок к плану', actual:Math.round(actual), expected:Math.round(expected) };
  }

  function buildTargetTrajectoryData(studentId, target, rows) {
    const targetPct = Number(target.target_percent || 80);
    const selected = targetTopicRows(target, rows);
    const lessons = targetLessonsUntil(studentId, target.target_date);
    const ranked = selected.map(row => ({
      ...row,
      _priority: targetTopicPriority(row, targetPct),
      _tasks: targetTaskCount(row.topic_id),
      _gap: row.mastery == null ? targetPct : Math.max(0, targetPct - Number(row.mastery))
    })).sort((a,b) => b._priority - a._priority);
    const noData = ranked.filter(x => x.mastery == null);
    const below = ranked.filter(x => x.mastery == null || Number(x.mastery) < targetPct);
    const bankGaps = ranked.filter(x => x._tasks < 3);
    const currentAverage = meanSafe(selected.map(x => x.mastery));
    const slotsBase = lessons.length ? lessons.map((lesson,i) => ({ lesson_id:lesson.id, scheduled_at:lesson.scheduled_at, scheduled_topic_id:lesson.topic_id || null, index:i+1 })) : Array.from({length:4},(_,i)=>({ lesson_id:null, scheduled_at:null, scheduled_topic_id:null, index:i+1 }));
    const focusPool = below.length ? below : ranked;
    const slots = slotsBase.map((base,i) => {
      const primary = focusPool[i % Math.max(1, focusPool.length)] || null;
      const secondary = focusPool.length > 1 ? focusPool[(i + Math.ceil(focusPool.length / 2)) % focusPool.length] : null;
      const primaryTitle = primary?.topics?.title || 'Диагностика текущего уровня';
      const reason = primary?.mastery == null ? 'Нет данных — сначала получить измерение.' : Number(primary.mastery) < targetPct ? `Текущий уровень ${Math.round(Number(primary.mastery))}% при цели ${targetPct}%.` : 'Поддержать освоенный навык до контрольной точки.';
      return {
        ...base,
        topic_id: primary?.topic_id || base.scheduled_topic_id || null,
        topic_title: primaryTitle,
        focus_topic_ids: [primary?.topic_id, secondary?.topic_id].filter(Boolean),
        focus: [primaryTitle, secondary && secondary.topic_id !== primary?.topic_id ? secondary.topics?.title : null].filter(Boolean),
        main_goal: primary?.mastery == null ? `Диагностировать и начать: ${primaryTitle}` : `Поднять устойчивость по теме «${primaryTitle}»`,
        homework_intent: i === slotsBase.length - 1 ? 'Короткая контрольная практика без новых типов задач' : 'Закрепить ключевой навык и вернуть одну старую тему на повторение',
        rationale: reason
      };
    });
    const capacityTopics = new Set(slots.flatMap(x => x.focus_topic_ids || []).map(String));
    const uncovered = below.filter(x => !capacityTopics.has(String(x.topic_id)));
    return {
      target_id:target.id,
      generated_at:new Date().toISOString(),
      target_percent:targetPct,
      target_date:target.target_date || null,
      days_left:targetDaysLeft(target),
      current_average:currentAverage,
      coverage_percent:selected.length ? Math.round(selected.filter(x=>x.mastery!=null).length * 100 / selected.length) : 0,
      scheduled_lessons:lessons.length,
      required_topics:selected.length,
      below_target:below.length,
      no_data:noData.length,
      bank_gaps:bankGaps.map(x=>({topic_id:x.topic_id,title:x.topics?.title||'Тема',tasks:x._tasks})),
      uncovered:uncovered.map(x=>({topic_id:x.topic_id,title:x.topics?.title||'Тема',mastery:x.mastery})),
      priorities:ranked.map(x=>({topic_id:x.topic_id,title:x.topics?.title||'Тема',section:x.topics?.section||'',mastery:x.mastery,evidence_count:x.evidence_count||0,trend:x.trend,tasks:x._tasks,gap:Math.round(x._gap),priority:x._priority})),
      slots,
      fingerprint:targetFingerprint(target,selected,lessons)
    };
  }

  async function getTargetTrajectory(targetId) {
    const {data,error}=await sb.from('student_target_trajectories').select('*').eq('target_id',targetId).maybeSingle();
    if(error) throw error;
    return data || null;
  }

  async function saveTargetTrajectory(studentId, target, plan, existing=null, autoRebalance=true) {
    const selected = targetTopicRows(target, await getTopicMastery(studentId,false));
    const lessons = targetLessonsUntil(studentId,target.target_date);
    const source = {
      fingerprint:plan.fingerprint,
      baseline_average:meanSafe(selected.map(x=>x.mastery)),
      topic_snapshot:selected.map(x=>({topic_id:x.topic_id,mastery:x.mastery,evidence_count:x.evidence_count||0})),
      scheduled_dates:lessons.map(x=>x.scheduled_at),
      target_percent:Number(target.target_percent||80)
    };
    const payload={teacher_id:S.user.id,student_id:studentId,target_id:target.id,plan,source_snapshot:source,auto_rebalance:!!autoRebalance,status:'active',generated_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    const q=existing?.id?sb.from('student_target_trajectories').update(payload).eq('id',existing.id):sb.from('student_target_trajectories').insert(payload);
    const {data,error}=await q.select().single(); if(error)throw error; return data;
  }

  async function ensureTargetTrajectory(studentId,target,rows) {
    const fresh=buildTargetTrajectoryData(studentId,target,rows), existing=await getTargetTrajectory(target.id);
    if(!existing) return saveTargetTrajectory(studentId,target,fresh,null,true);
    const oldFingerprint=existing?.plan?.fingerprint || existing?.source_snapshot?.fingerprint;
    if(existing.auto_rebalance && oldFingerprint !== fresh.fingerprint) {
      const selected=targetTopicRows(target,rows), tempo=targetTempo(existing,selected,target.target_percent||80);
      const source={...(existing.source_snapshot||{}),fingerprint:fresh.fingerprint,last_auto_rebalance_at:new Date().toISOString(),last_tempo:tempo};
      const {data,error}=await sb.from('student_target_trajectories').update({plan:fresh,source_snapshot:source,generated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',existing.id).select().single();
      if(error)throw error;
      await syncLinkedTargetRoadmap(studentId,target,fresh).catch(e=>console.warn('[Mathroom target roadmap sync]',e));
      return data;
    }
    return existing;
  }

  function trajectoryGapHtml(plan) {
    const bits=[];
    if(plan.no_data) bits.push(`<span class="pill warn">${plan.no_data} без данных</span>`);
    if(plan.uncovered?.length) bits.push(`<span class="pill danger">${plan.uncovered.length} не помещаются в план</span>`);
    if(plan.bank_gaps?.length) bits.push(`<span class="pill warn">${plan.bank_gaps.length} мало задач в банке</span>`);
    if(!bits.length) bits.push('<span class="pill good">Критичных пробелов покрытия нет</span>');
    return `<div class="mr-target-gap-pills">${bits.join('')}</div>`;
  }

  function trajectorySlotHtml(slot) {
    return `<article class="mr-target-slot"><div class="mr-roadmap-index">${slot.index}</div><div><div class="mr-target-slot-head"><b>${esc(slot.topic_title||'Тема')}</b><span class="pill">${slot.scheduled_at?esc(compactWhen(slot.scheduled_at)):'без даты'}</span></div><p>${esc(slot.main_goal||'')}</p>${slot.focus?.length?`<div class="mr-review-mini">${slot.focus.map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>`:''}<small>${esc(slot.rationale||'')}</small></div></article>`;
  }

  function targetTrajectoryRoadmapSlots(target,plan) {
    return (plan.slots||[]).slice(0,4).map((s,i)=>({
      index:i+1,lesson_id:s.lesson_id||null,scheduled_at:s.scheduled_at||null,topic_id:s.topic_id||null,topic_title:s.topic_title||`Занятие ${i+1}`,
      main_goal:s.main_goal||'',focus:s.focus||[],homework_intent:s.homework_intent||'',rationale:`Контрольная цель: ${target.title}. ${s.rationale||''}`
    }));
  }

  async function syncLinkedTargetRoadmap(studentId,target,plan) {
    const current=await getActiveRoadmap(studentId);
    if(!current || current?.source_snapshot?.mode!=='readiness-trajectory' || String(current?.source_snapshot?.target_id)!==String(target.id)) return false;
    const source={...(current.source_snapshot||{}),generated_at:new Date().toISOString(),target_id:target.id,target_title:target.title,target_date:target.target_date,target_percent:target.target_percent,mode:'readiness-trajectory',auto_adjusted_at:new Date().toISOString()};
    await saveRoadmap(studentId,targetTrajectoryRoadmapSlots(target,plan),source,current);
    return true;
  }

  async function applyTargetTrajectoryToRoadmap(studentId,target,plan) {
    const slots=targetTrajectoryRoadmapSlots(target,plan);
    const source={generated_at:new Date().toISOString(),target_id:target.id,target_title:target.title,target_date:target.target_date,target_percent:target.target_percent,mode:'readiness-trajectory'};
    const current=await getActiveRoadmap(studentId);
    await saveRoadmap(studentId,slots,source,current);
    toast('Первые 4 шага перенесены в план занятий');
  }

  async function openTargetTrajectory(studentId,target,providedRows=null) {
    try {
      const rows=providedRows||await getTopicMastery(studentId,true), selected=targetTopicRows(target,rows);
      let record=await ensureTargetTrajectory(studentId,target,rows), plan=record.plan||buildTargetTrajectoryData(studentId,target,rows);
      const tempo=targetTempo(record,selected,target.target_percent||80), st=(S.students||[]).find(x=>x.id===studentId);
      const render=()=>`<div class="mr-card-head"><div><h2>План до даты</h2><p class="muted">${esc(st?.name||'Ученик')} · ${esc(target.title)}</p></div><span class="pill ${record.auto_rebalance?'good':''}">${record.auto_rebalance?'автокоррекция включена':'ручной план'}</span></div>
        <div class="notice"><b>Это учебная траектория, не прогноз оценки.</b> Mathroom распределяет обязательные темы по реально запланированным занятиям и пересобирает рекомендации, когда меняются фактические результаты. Планы уроков меняются только после твоего подтверждения.</div>
        <div class="mr-compare-metrics"><span><small>До даты</small><b>${plan.days_left==null?'—':plan.days_left<0?'срок прошёл':plan.days_left+' дн.'}</b></span><span><small>Уроков до даты</small><b>${plan.scheduled_lessons}</b></span><span><small>Обязательных тем</small><b>${plan.required_topics}</b></span><span><small>Текущий уровень</small><b>${plan.current_average==null?'—':plan.current_average+'%'}</b></span></div>
        ${tempo?`<div class="mr-target-tempo ${tempo.key}"><b>${esc(tempo.label)}</b><span>фактический сдвиг ${tempo.actual>0?'+':''}${tempo.actual} п.п. · ориентир плана ${tempo.expected>0?'+':''}${tempo.expected} п.п.</span></div>`:''}
        ${trajectoryGapHtml(plan)}
        <div class="mr-target-layout"><section><h3>Что успеть</h3><div class="mr-target-priority-list">${(plan.priorities||[]).map((x,i)=>`<div><span><b>${i+1}. ${esc(x.title)}</b><small>${esc(x.section||'')} · ${x.evidence_count} сигналов · задач в банке ${x.tasks}</small></span><em>${x.mastery==null?'нет данных':Math.round(Number(x.mastery))+'%'}</em></div>`).join('')}</div></section><section><h3>Распределение по занятиям</h3><div class="mr-target-slots">${(plan.slots||[]).map(trajectorySlotHtml).join('')}</div></section></div>
        ${(plan.uncovered?.length||plan.bank_gaps?.length)?`<div class="mr-target-gaps"><h3>Пробелы покрытия</h3>${plan.uncovered?.length?`<p><b>Не помещаются в текущие уроки:</b> ${plan.uncovered.map(x=>esc(x.title)).join(' · ')}</p>`:''}${plan.bank_gaps?.length?`<p><b>Мало задач в банке:</b> ${plan.bank_gaps.map(x=>`${esc(x.title)} (${x.tasks})`).join(' · ')}</p>`:''}</div>`:''}
        <div class="actions"><button class="btn" id="mrTargetRebuild">↻ Пересобрать сейчас</button><button class="btn" id="mrTargetAuto">${record.auto_rebalance?'Выключить':'Включить'} автокоррекцию</button><button class="btn" id="mrTargetDiag">Диагностика пробелов</button><button class="btn primary" id="mrTargetRoadmap">В план 4 занятий</button></div>`;
      const m=modal(render(),'wide-modal');
      const bind=()=>{
        m.querySelector('#mrTargetRebuild').onclick=async()=>{try{const freshRows=await getTopicMastery(studentId,true);plan=buildTargetTrajectoryData(studentId,target,freshRows);record=await saveTargetTrajectory(studentId,target,plan,record,record.auto_rebalance);m.remove();toast('Траектория пересобрана');await openTargetTrajectory(studentId,target,freshRows)}catch(e){fail(e)}};
        m.querySelector('#mrTargetAuto').onclick=async()=>{try{const next=!record.auto_rebalance;const{data,error}=await sb.from('student_target_trajectories').update({auto_rebalance:next,updated_at:new Date().toISOString()}).eq('id',record.id).select().single();if(error)throw error;record=data;m.remove();toast(next?'Автокоррекция включена':'Автокоррекция выключена');await openTargetTrajectory(studentId,target,rows)}catch(e){fail(e)}};
        m.querySelector('#mrTargetDiag').onclick=()=>{const ids=(plan.priorities||[]).filter(x=>x.mastery==null||Number(x.mastery)<Number(target.target_percent||80)).slice(0,6).map(x=>x.topic_id);openDiagnosticCreator(studentId,rows,ids.length?ids:target.topic_ids,`Диагностика пробелов · ${target.title}`)};
        m.querySelector('#mrTargetRoadmap').onclick=async()=>{try{await applyTargetTrajectoryToRoadmap(studentId,target,plan);document.querySelector('#mrRoadmapOverview')?.remove();await enhanceRoadmapOverview()}catch(e){fail(e)}};
      };
      bind();
    } catch(e) { fail(e); }
  }

  async function enhanceTargetTrajectoryOverview() {
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrTargetTrajectory'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const studentId=S.selectedStudent,[rows,targets]=await Promise.all([getTopicMastery(studentId,false),getReadinessTargets(studentId)]);
      const active=targets.filter(x=>x.status==='active').sort((a,b)=>String(a.target_date||'9999').localeCompare(String(b.target_date||'9999')));
      if(!active.length||S.view!=='profile'||S.selectedStudent!==studentId)return;
      const target=active[0],record=await ensureTargetTrajectory(studentId,target,rows),plan=record.plan||buildTargetTrajectoryData(studentId,target,rows),tempo=targetTempo(record,targetTopicRows(target,rows),target.target_percent||80);
      if(document.querySelector('#mrTargetTrajectory'))return;
      const box=document.createElement('div');box.id='mrTargetTrajectory';box.className='card mr-target-trajectory';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Траектория к цели</h2><p class="small muted">${esc(target.title)}${target.target_date?` · до ${new Date(target.target_date+'T00:00:00').toLocaleDateString('ru-RU')}`:''}</p></div><button class="btn sm primary" id="mrTargetTrajectoryOpen">План до даты</button></div><div class="mr-target-overview"><span><b>${plan.current_average==null?'—':plan.current_average+'%'}</b><small>текущий уровень</small></span><span><b>${plan.scheduled_lessons}</b><small>уроков до даты</small></span><span><b>${plan.below_target}</b><small>тем ниже цели</small></span><span><b>${plan.no_data}</b><small>тем без данных</small></span></div>${tempo?`<div class="small ${tempo.key==='behind'?'warn':tempo.key==='ahead'?'good':'muted'}">${esc(tempo.label)}</div>`:''}${trajectoryGapHtml(plan)}`;
      const anchor=document.querySelector('#mrLearningIntelligence')||document.querySelector('#mrRoadmapOverview')||document.querySelector('#mrMasteryOverview');anchor?.insertAdjacentElement('afterend',box);
      box.querySelector('#mrTargetTrajectoryOpen').onclick=()=>openTargetTrajectory(studentId,target,rows);
    }catch(e){console.warn('[Mathroom target trajectory]',e)}
  }

  async function enhanceStudentProgressSnapshots() {
    if(!S.access||S.studentTab!=='progress'||!S.student||document.querySelector('#mrStudentSnapshots'))return;
    const content=document.querySelector('#studentContent');if(!content)return;
    try{const{data,error}=await sb.rpc('get_my_progress_snapshots',{p_limit:12});if(error)throw error;const snapshots=Array.isArray(data)?data:[];if(S.studentTab!=='progress'||document.querySelector('#mrStudentSnapshots'))return;const latest=snapshots[0],prev=nearestSnapshot(snapshots,30);const previous=prev?.id===latest?.id?snapshots.find(x=>x.id!==latest?.id):prev;const box=document.createElement('div');box.id='mrStudentSnapshots';box.className='card mr-student-snapshots';box.innerHTML=`<div class="mr-card-head"><div><h2>Как меняется прогресс</h2><p class="small muted">История сохранённых срезов карты тем.</p></div></div>${snapshotDiffHtml(latest,previous)}${snapshotChartHtml(snapshots)}`;const mastery=document.querySelector('#mrStudentMastery');if(mastery)mastery.insertAdjacentElement('afterend',box);else content.append(box)}catch(e){console.warn('[Mathroom student snapshots]',e)}
  }

  async function enhanceTeacherProfile() {
    if (S.access || S.view !== 'profile' || !S.selectedStudent || document.querySelector('#mrGoalsOverview')) return;
    const content = document.querySelector('.content'); if (!content) return;
    try {
      const goals = await getStudentGoals(S.selectedStudent, true);
      if (S.view !== 'profile' || document.querySelector('#mrGoalsOverview')) return;
      const active = goals.filter(x => x.status === 'active'), completed = goals.filter(x => x.status === 'completed');
      const box = document.createElement('div'); box.id = 'mrGoalsOverview'; box.className = 'card mr-goals-overview';
      box.innerHTML = `<div class="mr-card-head"><div><h2>Цели обучения</h2><p class="small muted">${active.length} активных · ${completed.length} завершённых</p></div><div class="actions"><button class="btn sm" id="mrParentReportOpen">Отчёт родителю</button><button class="btn sm primary" id="mrGoalsManage">Управлять целями</button></div></div>${active.length ? `<div class="mr-goal-grid">${active.slice(0,4).map(g => `<div class="mr-goal-card"><b>${esc(g.title)}</b>${goalProgressHtml(g)}${g.description ? `<p class="small muted">${esc(g.description)}</p>` : ''}</div>`).join('')}</div>` : '<div class="empty">Добавь первую долгосрочную цель ученика.</div>'}`;
      const metrics = content.querySelector('.profile-metrics') || content.querySelector('.grid.cols4');
      if (metrics) metrics.insertAdjacentElement('afterend', box); else content.prepend(box);
      box.querySelector('#mrGoalsManage').onclick = () => openGoalsManager(S.selectedStudent);
      box.querySelector('#mrParentReportOpen').onclick = () => openParentReport(S.selectedStudent, 28);
    } catch (e) { console.warn('[Mathroom goals]', e); }
  }

  async function enhanceStudentGoals() {
    if (!S.access || S.studentTab !== 'progress' || !S.student || document.querySelector('#mrStudentGoals')) return;
    const content = document.querySelector('#studentContent'); if (!content) return;
    try {
      const { data, error } = await sb.rpc('get_my_goals'); if (error) throw error;
      const goals = Array.isArray(data) ? data : [];
      if (S.studentTab !== 'progress' || document.querySelector('#mrStudentGoals')) return;
      const box = document.createElement('div'); box.id = 'mrStudentGoals'; box.className = 'card mr-student-goals';
      box.innerHTML = `<div class="mr-card-head"><div><h2>Мои цели</h2><p class="small muted">Прогресс по целям, которые вы зафиксировали вместе с преподавателем.</p></div></div>${goals.length ? `<div class="mr-goal-grid">${goals.map(g => `<div class="mr-goal-card ${g.status}"><div class="mr-goal-title"><b>${esc(g.title)}</b><span class="pill">${goalStatusLabel(g.status)}</span></div>${goalProgressHtml(g)}${g.description ? `<p class="small muted">${esc(g.description)}</p>` : ''}</div>`).join('')}</div>` : '<div class="empty">Цели пока не добавлены.</div>'}`;
      content.prepend(box);
    } catch (e) { console.warn('[Mathroom student goals]', e); }
  }



  // Iteration 13/21 — weekly schedule, direct deletion and open-ended recurring lessons.
  let scheduleWeekCursor = null;
  let scheduleStudentFilter = 'all';
  let scheduleRuleMap = new Map();

  function startOfLocalWeek(value = new Date()) {
    const d = new Date(value); d.setHours(0,0,0,0);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
  }
  function endOfLocalWeek(value) { const d = startOfLocalWeek(value); d.setDate(d.getDate()+7); return d; }
  function sameLocalDay(a,b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function isoLocalInput(value) {
    if (!value) return '';
    const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
    const pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function compactClock(value) { return value ? new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '—'; }
  function shortDay(value) { return new Date(value).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}); }
  function scheduleLessonLabel(l) {
    if (l.status === 'completed') return ['Завершён','ok'];
    if (l.status === 'in_progress') return ['Идёт урок','warn'];
    if (l.rescheduled_from && Math.abs(new Date(l.rescheduled_from)-new Date(l.scheduled_at))>60000) return ['Перенесён','warn'];
    return ['Запланирован',''];
  }
  function lessonStudentName(l) { return l.students?.name || S.students.find(x=>x.id===l.student_id)?.name || 'Ученик'; }
  function lessonTopicName(l) { return l.topics?.title || S.topics.find(x=>x.id===l.topic_id)?.title || 'Без темы'; }
  function scheduleRuleFor(l){ return l?.recurrence_series_id ? scheduleRuleMap.get(l.recurrence_series_id) || null : null; }
  function isInfiniteSeries(l){ return !!scheduleRuleFor(l); }

  async function loadScheduleRules(){
    scheduleRuleMap = new Map();
    if(!S.user) return;
    const {data,error}=await sb.from('lesson_recurrence_rules').select('*').eq('teacher_id',S.user.id);
    if(error){
      console.warn('[Mathroom recurring rules]',error);
      return;
    }
    for(const row of data||[]) scheduleRuleMap.set(row.id,row);
  }

  async function materializeRecurringLessons(){
    try{
      const {error}=await sb.rpc('materialize_my_recurring_lessons',{p_horizon_weeks:104});
      if(error) throw error;
    }catch(e){
      console.warn('[Mathroom recurring materializer]',e);
    }
  }

  async function reloadScheduleLessons() {
    await materializeRecurringLessons();
    await loadScheduleRules();
    const { data, error } = await sb.from('lessons').select('*,students(name,grade),topics(title)').order('scheduled_at',{ascending:true});
    if (error) throw error;
    S.lessons = data || [];
  }
  async function rerenderScheduleFromServer(message='') {
    await reloadScheduleLessons();
    if (message) toast(message);
    const nav = document.querySelector('[data-nav="schedule"]');
    if (nav) nav.click();
  }

  function scheduleWeekTitle(start) {
    const end = new Date(start); end.setDate(end.getDate()+6);
    const left = start.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    const right = end.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
    return `${left} — ${right}`;
  }

  function scheduleCardHtml(l) {
    const [label,cls] = scheduleLessonLabel(l);
    const moved = l.rescheduled_from && Math.abs(new Date(l.rescheduled_from)-new Date(l.scheduled_at))>60000;
    const rule = scheduleRuleFor(l);
    const series = !!l.recurrence_series_id;
    const canStart = l.status==='assigned' || l.status==='in_progress';
    const canEdit = l.status==='assigned';
    const seriesText = rule ? `↻ каждые ${Number(rule.interval_weeks||1)===1?'неделю':rule.interval_weeks+' нед.'}` : (series ? `↻ серия${l.recurrence_position?` ${l.recurrence_position}/${l.recurrence_total||'?'}`:''}` : '');
    return `<article class="mr-calendar-lesson ${l.status==='completed'?'completed':''}" draggable="${canEdit?'true':'false'}" data-cal-lesson="${l.id}">
      <div class="mr-calendar-lesson-top"><b>${compactClock(l.scheduled_at)} · ${Number(l.duration_minutes||60)} мин</b><span class="pill ${cls}">${label}</span></div>
      <strong>${esc(lessonStudentName(l))}</strong>
      <span class="mr-calendar-topic">${esc(lessonTopicName(l))}</span>
      <div class="mr-calendar-tags">${seriesText?`<span class="pill">${esc(seriesText)}</span>`:''}${moved?`<span class="pill warn">было ${esc(shortDay(l.rescheduled_from))} ${esc(compactClock(l.rescheduled_from))}</span>`:''}</div>
      ${l.schedule_note?`<small class="mr-calendar-note">${esc(l.schedule_note)}</small>`:''}
      <div class="mr-calendar-actions">
        ${canStart?`<button class="btn sm primary" data-cal-start="${l.id}">${l.status==='in_progress'?'Продолжить':'Начать'}</button>`:''}
        ${canEdit?`<button class="btn sm" data-cal-move="${l.id}">Перенести</button>${rule?`<button class="btn sm" data-cal-skip-next="${l.id}">⏭ След. неделя</button><button class="btn sm" data-cal-pause="${l.id}">⏸ Пауза</button>`:''}<button class="btn sm danger" data-cal-delete="${l.id}">Удалить</button>`:''}
      </div>
    </article>`;
  }


  function scheduleTemplateKey(){return `mathroom.schedule.weekTemplates.${S.user?.id||'teacher'}`}
  function getWeekTemplates(){try{const v=JSON.parse(localStorage.getItem(scheduleTemplateKey())||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
  function setWeekTemplates(v){localStorage.setItem(scheduleTemplateKey(),JSON.stringify((v||[]).slice(0,20)))}
  function weekTemplateRows(start){const end=endOfLocalWeek(start);return (S.lessons||[]).filter(l=>l.status==='assigned'&&new Date(l.scheduled_at)>=start&&new Date(l.scheduled_at)<end).map(l=>{const d=new Date(l.scheduled_at),day=Math.floor((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(start.getFullYear(),start.getMonth(),start.getDate()))/86400000);return{day,hour:d.getHours(),minute:d.getMinutes(),student_id:l.student_id,topic_id:l.topic_id,duration_minutes:Number(l.duration_minutes||60)}})}
  function openWeekTemplates(){const start=startOfLocalWeek(scheduleWeekCursor||new Date()),list=getWeekTemplates();const m=modal(`<div class="mr-card-head"><div><h2>Шаблоны недели</h2><p class="muted">Сохраняй привычное расписание и разворачивай его на нужную неделю.</p></div><button class="btn sm primary" id="mrSaveWeekTemplate">Сохранить текущую неделю</button></div><div class="list">${list.length?list.map(t=>`<div class="row"><div><b>${esc(t.name)}</b><div class="small muted">${t.rows?.length||0} занятий</div></div><div class="actions"><button class="btn sm primary" data-apply-week="${t.id}">Применить</button><button class="btn sm danger" data-del-week="${t.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Шаблонов пока нет.</div>'}</div>`,'wide-modal');
    m.querySelector('#mrSaveWeekTemplate').onclick=()=>{const rows=weekTemplateRows(start);if(!rows.length)return toast('На этой неделе нет запланированных занятий');const name=prompt('Название шаблона:','Обычная неделя');if(!name)return;setWeekTemplates([{id:uid(),name:name.trim(),rows,created_at:new Date().toISOString()},...getWeekTemplates()]);m.remove();toast('Шаблон недели сохранён')};
    m.querySelectorAll('[data-del-week]').forEach(b=>b.onclick=()=>{setWeekTemplates(list.filter(x=>x.id!==b.dataset.delWeek));b.closest('.row')?.remove();toast('Шаблон удалён')});
    m.querySelectorAll('[data-apply-week]').forEach(b=>b.onclick=async()=>{const t=list.find(x=>x.id===b.dataset.applyWeek);if(!t)return;if(!confirm(`Добавить ${t.rows?.length||0} занятий из шаблона на ${scheduleWeekTitle(start)}? Уже существующие занятия не удаляются.`))return;try{const existing=(S.lessons||[]).filter(l=>l.status==='assigned').map(l=>`${l.student_id}|${new Date(l.scheduled_at).toISOString().slice(0,16)}`),seen=new Set(existing),rows=[];for(const r of t.rows||[]){const d=new Date(start);d.setDate(d.getDate()+Number(r.day||0));d.setHours(Number(r.hour||0),Number(r.minute||0),0,0);const key=`${r.student_id}|${d.toISOString().slice(0,16)}`;if(seen.has(key))continue;seen.add(key);rows.push({teacher_id:S.user.id,student_id:r.student_id,topic_id:r.topic_id,scheduled_at:d.toISOString(),duration_minutes:Number(r.duration_minutes||60)})}if(rows.length){const{error}=await sb.from('lessons').insert(rows);if(error)throw error}m.remove();await rerenderScheduleFromServer(rows.length?`Из шаблона добавлено: ${rows.length}`:'Все занятия шаблона уже есть на неделе')}catch(e){fail(e)}})
  }
  async function skipNextSeriesOccurrence(l){const rule=scheduleRuleFor(l);if(!rule)return;const base=new Date(l.rescheduled_from||l.scheduled_at),target=new Date(base);target.setDate(target.getDate()+7*Math.max(1,Number(rule.interval_weeks||1)));if(!confirm(`Пропустить следующее занятие серии: ${target.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}?`))return;try{const occurrence=target.toISOString(),{error}=await sb.from('lesson_recurrence_exceptions').upsert({series_id:rule.id,occurrence_at:occurrence},{onConflict:'series_id,occurrence_at'});if(error)throw error;const candidates=(S.lessons||[]).filter(x=>x.recurrence_series_id===rule.id&&x.status==='assigned'&&Math.abs(new Date(x.rescheduled_from||x.scheduled_at)-target)<60000).map(x=>x.id);if(candidates.length){const{error:de}=await sb.from('lessons').delete().in('id',candidates);if(de)throw de}await rerenderScheduleFromServer('Следующее занятие серии пропущено')}catch(e){fail(e)}}
  function openPauseSeries(l){const rule=scheduleRuleFor(l);if(!rule)return;const base=new Date(l.rescheduled_from||l.scheduled_at),suggest=new Date(base);suggest.setDate(suggest.getDate()+28);const m=modal(`<h2>Пауза серии</h2><p class="muted">${esc(lessonStudentName(l))} · занятия будут пропущены, а серия автоматически продолжится после выбранной даты.</p><div class="field"><label>Возобновить с даты</label><input id="mrPauseUntil" type="date" value="${suggest.toISOString().slice(0,10)}"></div><button class="btn primary" id="mrPauseApply">Поставить серию на паузу</button>`);m.querySelector('#mrPauseApply').onclick=async()=>{const raw=m.querySelector('#mrPauseUntil').value;if(!raw)return;const until=new Date(raw+'T00:00:00');if(!(until>base))return toast('Дата возобновления должна быть позже выбранного занятия');try{const rows=[];const step=7*Math.max(1,Number(rule.interval_weeks||1));for(let d=new Date(base);d<until;d.setDate(d.getDate()+step))rows.push({series_id:rule.id,occurrence_at:new Date(d).toISOString()});if(rows.length){const{error}=await sb.from('lesson_recurrence_exceptions').upsert(rows,{onConflict:'series_id,occurrence_at'});if(error)throw error}const ids=(S.lessons||[]).filter(x=>x.recurrence_series_id===rule.id&&x.status==='assigned'&&new Date(x.rescheduled_from||x.scheduled_at)>=base&&new Date(x.rescheduled_from||x.scheduled_at)<until).map(x=>x.id);if(ids.length){const{error}=await sb.from('lessons').delete().in('id',ids);if(error)throw error}m.remove();await rerenderScheduleFromServer(`Серия на паузе до ${until.toLocaleDateString('ru-RU')}`)}catch(e){fail(e)}}}

  function scheduleLoadHtml(weekLessons, days) {
    const active=weekLessons.filter(x=>x.status!=='cancelled'), total=active.reduce((s,x)=>s+Number(x.duration_minutes||0),0);
    const mins=days.map(day=>active.filter(l=>sameLocalDay(new Date(l.scheduled_at),day)).reduce((s,l)=>s+Number(l.duration_minutes||0),0));
    const max=Math.max(60,...mins);
    return `<div class="mr-week-load">${days.map((d,i)=>`<div class="mr-week-load-day"><span>${d.toLocaleDateString('ru-RU',{weekday:'short'})}</span><div><i style="width:${Math.round(mins[i]/max*100)}%"></i></div><b>${mins[i]?`${Math.floor(mins[i]/60)}ч ${mins[i]%60?mins[i]%60+'м':''}`:'—'}</b></div>`).join('')}</div><div class="small muted">Всего на неделе: ${Math.floor(total/60)} ч ${total%60} мин чистого учебного времени.</div>`;
  }

  async function recordRecurrenceException(l){
    const rule=scheduleRuleFor(l);
    if(!rule)return;
    const occurrence=l.rescheduled_from||l.scheduled_at;
    const {error}=await sb.from('lesson_recurrence_exceptions').upsert({series_id:rule.id,occurrence_at:occurrence},{onConflict:'series_id,occurrence_at'});
    if(error)throw error;
  }

  function bindScheduleDrag(root) {
    let dragged='';
    root.querySelectorAll('[data-cal-lesson][draggable="true"]').forEach(card=>{
      card.addEventListener('dragstart',e=>{dragged=card.dataset.calLesson; card.classList.add('dragging'); try{e.dataTransfer.setData('text/plain',dragged)}catch{}});
      card.addEventListener('dragend',()=>{card.classList.remove('dragging'); dragged=''; root.querySelectorAll('.mr-calendar-day').forEach(x=>x.classList.remove('drop-target'))});
    });
    root.querySelectorAll('[data-cal-day]').forEach(day=>{
      day.addEventListener('dragover',e=>{if(!dragged)return;e.preventDefault();day.classList.add('drop-target')});
      day.addEventListener('dragleave',()=>day.classList.remove('drop-target'));
      day.addEventListener('drop',async e=>{
        e.preventDefault(); day.classList.remove('drop-target');
        const id=dragged||e.dataTransfer?.getData('text/plain'); const l=S.lessons.find(x=>x.id===id); if(!l||l.status!=='assigned')return;
        const target=new Date(day.dataset.calDay+'T00:00:00'); const old=new Date(l.scheduled_at); target.setHours(old.getHours(),old.getMinutes(),0,0);
        if(sameLocalDay(target,old))return;
        if(!confirm(`Перенести ${lessonStudentName(l)} на ${target.toLocaleDateString('ru-RU')} в ${compactClock(target)}?`))return;
        try{
          if(isInfiniteSeries(l))await recordRecurrenceException(l);
          const {error}=await sb.from('lessons').update({scheduled_at:target.toISOString(),rescheduled_from:l.rescheduled_from||l.scheduled_at,schedule_updated_at:new Date().toISOString()}).eq('id',l.id);
          if(error)throw error;
          await rerenderScheduleFromServer('Урок перенесён');
        }catch(err){fail(err)}
      });
    });
  }

  function bindEnhancedSchedule(root) {
    root.querySelector('#mrWeekPrev').onclick=()=>{const d=startOfLocalWeek(scheduleWeekCursor||new Date());d.setDate(d.getDate()-7);scheduleWeekCursor=d;renderEnhancedSchedule(root)};
    root.querySelector('#mrWeekToday').onclick=()=>{scheduleWeekCursor=startOfLocalWeek(new Date());renderEnhancedSchedule(root)};
    root.querySelector('#mrWeekNext').onclick=()=>{const d=startOfLocalWeek(scheduleWeekCursor||new Date());d.setDate(d.getDate()+7);scheduleWeekCursor=d;renderEnhancedSchedule(root)};
    root.querySelector('#mrScheduleStudentFilter').onchange=e=>{scheduleStudentFilter=e.target.value;renderEnhancedSchedule(root)};
    root.querySelector('#mrWeekTemplates')&&(root.querySelector('#mrWeekTemplates').onclick=openWeekTemplates);
    root.querySelector('#mrScheduleCreate').onsubmit=async e=>{
      e.preventDefault();
      const student=root.querySelector('#mrScStudent').value, topic=root.querySelector('#mrScTopic').value, when=root.querySelector('#mrScWhen').value;
      const duration=Math.max(15,Number(root.querySelector('#mrScDuration').value||60));
      const repeatValue=root.querySelector('#mrScRepeat').value;
      const interval=Math.max(1,Number(root.querySelector('#mrScInterval').value||1));
      if(!student||!topic||!when)return toast('Выбери ученика, тему и время');
      const first=new Date(when);if(Number.isNaN(first.getTime()))return toast('Проверь дату и время');
      try{
        if(repeatValue==='forever'){
          const {error}=await sb.from('lesson_recurrence_rules').insert({
            teacher_id:S.user.id,student_id:student,topic_id:topic,starts_at:first.toISOString(),duration_minutes:duration,interval_weeks:interval,active:true
          });
          if(error)throw error;
          await rerenderScheduleFromServer('Бессрочное расписание создано');
          return;
        }
        const count=Math.max(1,Number(repeatValue||1));
        const series=count>1?(crypto.randomUUID?crypto.randomUUID():uid()):null;
        const rows=[];
        for(let i=0;i<count;i++){
          const d=new Date(first);d.setDate(d.getDate()+i*interval*7);
          rows.push({teacher_id:S.user.id,student_id:student,topic_id:topic,scheduled_at:d.toISOString(),duration_minutes:duration,recurrence_series_id:series,recurrence_position:series?i+1:null,recurrence_total:series?count:null,recurrence_interval_weeks:series?interval:null});
        }
        const {error}=await sb.from('lessons').insert(rows);if(error)throw error;
        await rerenderScheduleFromServer(count>1?`Создано ${count} занятий`:'Урок добавлен');
      }catch(err){fail(err)}
    };
    root.querySelectorAll('[data-cal-start]').forEach(b=>b.onclick=()=>{
      const legacy=document.querySelector(`.mr-schedule-legacy [data-open-lesson="${CSS.escape(b.dataset.calStart)}"]`);
      if(legacy)legacy.click();else toast('Обнови расписание и попробуй ещё раз');
    });
    root.querySelectorAll('[data-cal-move]').forEach(b=>b.onclick=()=>openRescheduleLesson(b.dataset.calMove));
    root.querySelectorAll('[data-cal-delete]').forEach(b=>b.onclick=()=>openDeleteLesson(b.dataset.calDelete));
    root.querySelectorAll('[data-cal-skip-next]').forEach(b=>b.onclick=()=>{const l=S.lessons.find(x=>x.id===b.dataset.calSkipNext);if(l)skipNextSeriesOccurrence(l)});
    root.querySelectorAll('[data-cal-pause]').forEach(b=>b.onclick=()=>{const l=S.lessons.find(x=>x.id===b.dataset.calPause);if(l)openPauseSeries(l)});
    bindScheduleDrag(root);
  }

  function renderEnhancedSchedule(root) {
    if(!scheduleWeekCursor)scheduleWeekCursor=startOfLocalWeek(new Date());
    const start=startOfLocalWeek(scheduleWeekCursor), end=endOfLocalWeek(start);
    const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d});
    const lessons=[...S.lessons].filter(x=>x.scheduled_at&&x.status!=='cancelled').sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
    const weekAll=lessons.filter(x=>{const t=new Date(x.scheduled_at);return t>=start&&t<end});
    const filtered=weekAll.filter(x=>(scheduleStudentFilter==='all'||x.student_id===scheduleStudentFilter));
    const moved=weekAll.filter(x=>x.rescheduled_from&&Math.abs(new Date(x.rescheduled_from)-new Date(x.scheduled_at))>60000).length;
    const totalMins=weekAll.reduce((s,x)=>s+Number(x.duration_minutes||0),0);
    const activeRules=[...scheduleRuleMap.values()].filter(x=>x.active!==false).length;
    const studentOpts=S.students.map(x=>`<option value="${x.id}" ${scheduleStudentFilter===x.id?'selected':''}>${esc(x.name)} · ${x.grade} кл.</option>`).join('');
    const topicOpts=S.topics.map(x=>`<option value="${x.id}">${x.grade} кл. · ${esc(x.title)}</option>`).join('');
    root.innerHTML=`<div class="mr-schedule-toolbar card"><div><h2>Неделя</h2><p class="muted">${esc(scheduleWeekTitle(start))}</p></div><div class="actions"><button class="btn sm" id="mrWeekPrev">←</button><button class="btn sm" id="mrWeekToday">Сегодня</button><button class="btn sm" id="mrWeekNext">→</button><button class="btn sm" id="mrWeekTemplates">▦ Шаблоны недели</button></div></div>
      <div class="grid cols4 mr-schedule-metrics"><div class="card"><div class="muted">Занятий</div><div class="metric">${weekAll.length}</div></div><div class="card"><div class="muted">Нагрузка</div><div class="metric">${(totalMins/60).toFixed(totalMins%60?1:0)} ч</div></div><div class="card"><div class="muted">Переносов</div><div class="metric">${moved}</div></div><div class="card"><div class="muted">Бессрочных серий</div><div class="metric">${activeRules}</div></div></div>
      <div class="card mr-week-load-card"><div class="mr-card-head"><div><h2>Загрузка недели</h2><p class="small muted">Удалённые занятия исчезают полностью из расписания.</p></div><div class="actions"><select id="mrScheduleStudentFilter"><option value="all">Все ученики</option>${studentOpts}</select></div></div>${scheduleLoadHtml(weekAll,days)}</div>
      <div class="card mr-schedule-create"><div class="mr-card-head"><div><h2>Добавить занятие</h2><p class="small muted">Можно создать одно занятие, конечную серию или расписание «каждую неделю, пока не остановлю».</p></div></div><form id="mrScheduleCreate" class="mr-schedule-form"><div class="field"><label>Ученик</label><select id="mrScStudent">${studentOpts.replaceAll(' selected','')}</select></div><div class="field"><label>Тема</label><select id="mrScTopic">${topicOpts}</select></div><div class="field"><label>Дата и время</label><input id="mrScWhen" type="datetime-local" required></div><div class="field"><label>Минут</label><input id="mrScDuration" type="number" min="15" step="5" value="60"></div><div class="field"><label>Повтор</label><select id="mrScRepeat"><option value="1">Один урок</option><option value="4">4 занятия</option><option value="8">8 занятий</option><option value="12">12 занятий</option><option value="16">16 занятий</option><option value="forever">Каждую неделю, пока не остановлю</option></select></div><div class="field"><label>Каждые</label><select id="mrScInterval"><option value="1">1 неделю</option><option value="2">2 недели</option></select></div><button class="btn primary">Добавить</button></form></div>
      <div class="mr-calendar-week">${days.map(day=>{const dayItems=filtered.filter(l=>sameLocalDay(new Date(l.scheduled_at),day));const today=sameLocalDay(day,new Date());return `<section class="mr-calendar-day ${today?'today':''}" data-cal-day="${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}"><header><span>${day.toLocaleDateString('ru-RU',{weekday:'short'})}</span><b>${day.getDate()}</b><small>${day.toLocaleDateString('ru-RU',{month:'short'})}</small></header><div class="mr-calendar-day-body">${dayItems.length?dayItems.map(scheduleCardHtml).join(''):'<div class="mr-calendar-empty">Нет уроков</div>'}</div></section>`}).join('')}</div>
      <div class="small muted mr-schedule-tip">На компьютере запланированный урок можно перетащить на другой день. Бессрочная серия хранится как правило и автоматически создаёт будущие уроки; остановить её можно через «Удалить».</div>`;
    bindEnhancedSchedule(root);
    decorateScheduleAttendance(root);
  }

  async function openRescheduleLesson(id) {
    const l=S.lessons.find(x=>x.id===id);if(!l)return;
    const infinite=isInfiniteSeries(l);
    const futureSeries=!infinite&&l.recurrence_series_id?S.lessons.filter(x=>x.recurrence_series_id===l.recurrence_series_id&&x.status==='assigned'&&new Date(x.scheduled_at)>=new Date(l.scheduled_at)).length:0;
    const m=modal(`<h2>Перенести урок</h2><p class="muted">${esc(lessonStudentName(l))} · ${esc(lessonTopicName(l))}</p><form id="mrRescheduleForm"><div class="grid cols2"><div class="field"><label>Новая дата и время</label><input id="mrMoveWhen" type="datetime-local" value="${isoLocalInput(l.scheduled_at)}" required></div><div class="field"><label>Минут</label><input id="mrMoveDuration" type="number" min="15" step="5" value="${Number(l.duration_minutes||60)}"></div></div><div class="field"><label>Заметка</label><input id="mrMoveNote" value="${esc(l.schedule_note||'')}" placeholder="необязательно"></div>${futureSeries>1?`<label class="mr-inline-check"><input type="checkbox" id="mrMoveFuture"> сдвинуть это и следующие занятия серии (${futureSeries}) на столько же</label>`:''}${infinite?'<div class="notice">Для бессрочного расписания переносится только выбранная дата. Следующие недели сохраняют обычное время.</div>':''}<div class="actions"><button class="btn primary">Сохранить перенос</button></div></form>`, 'wide-modal');
    m.querySelector('#mrRescheduleForm').onsubmit=async e=>{
      e.preventDefault();const newDate=new Date(m.querySelector('#mrMoveWhen').value);if(Number.isNaN(newDate.getTime()))return toast('Проверь дату');
      const duration=Math.max(15,Number(m.querySelector('#mrMoveDuration').value||60)),note=m.querySelector('#mrMoveNote').value.trim();
      const delta=newDate.getTime()-new Date(l.scheduled_at).getTime();const moveFuture=!infinite&&!!m.querySelector('#mrMoveFuture')?.checked;
      let targets=[l];if(moveFuture)targets=S.lessons.filter(x=>x.recurrence_series_id===l.recurrence_series_id&&x.status==='assigned'&&new Date(x.scheduled_at)>=new Date(l.scheduled_at));
      try{
        if(infinite)await recordRecurrenceException(l);
        for(const x of targets){
          const shifted=moveFuture?new Date(new Date(x.scheduled_at).getTime()+delta):newDate;
          const changed=Math.abs(shifted-new Date(x.scheduled_at))>60000;
          const body={scheduled_at:shifted.toISOString(),duration_minutes:x.id===l.id?duration:Number(x.duration_minutes||duration),schedule_updated_at:new Date().toISOString()};
          if(changed)body.rescheduled_from=x.rescheduled_from||x.scheduled_at;
          if(x.id===l.id)body.schedule_note=note;
          const {error}=await sb.from('lessons').update(body).eq('id',x.id);if(error)throw error;
        }
        m.remove();await rerenderScheduleFromServer(moveFuture?`Перенесено занятий: ${targets.length}`:'Урок перенесён');
      }catch(err){fail(err)}
    };
  }

  async function openDeleteLesson(id){
    const l=S.lessons.find(x=>x.id===id);if(!l)return;
    const infinite=isInfiniteSeries(l);
    const future=l.recurrence_series_id?S.lessons.filter(x=>x.recurrence_series_id===l.recurrence_series_id&&x.status==='assigned'&&new Date(x.scheduled_at)>=new Date(l.scheduled_at)).length:0;
    const canSeries=!!l.recurrence_series_id&&(infinite||future>1);
    const m=modal(`<h2>Удалить занятие</h2><p class="muted">${esc(lessonStudentName(l))} · ${esc(lessonTopicName(l))} · ${esc(dateLong(l.scheduled_at))}</p><div class="notice"><b>Удаление скрывает занятие полностью.</b> В расписании и кабинете ученика его больше не будет.</div><div class="mr-delete-schedule-options"><button class="btn danger" id="mrDeleteOne">Удалить только это занятие</button>${canSeries?`<button class="btn danger" id="mrDeleteFuture">${infinite?'Остановить серию с этой даты':'Удалить это и следующие занятия серии'}</button>`:''}</div>`);
    m.querySelector('#mrDeleteOne').onclick=async()=>{
      if(!confirm('Удалить выбранное занятие без возможности восстановления?'))return;
      try{
        if(infinite)await recordRecurrenceException(l);
        const {error}=await sb.from('lessons').delete().eq('id',l.id);if(error)throw error;
        m.remove();await rerenderScheduleFromServer('Занятие удалено');
      }catch(err){fail(err)}
    };
    const futureBtn=m.querySelector('#mrDeleteFuture');
    if(futureBtn)futureBtn.onclick=async()=>{
      const text=infinite?'Остановить бессрочное расписание с этой даты и удалить уже созданные будущие занятия?':'Удалить выбранное и все следующие занятия этой серии?';
      if(!confirm(text))return;
      try{
        if(infinite){
          const rule=scheduleRuleFor(l);
          const {error:ruleError}=await sb.from('lesson_recurrence_rules').update({active:false,stopped_at:l.rescheduled_from||l.scheduled_at,updated_at:new Date().toISOString()}).eq('id',rule.id);
          if(ruleError)throw ruleError;
        }
        const ids=S.lessons.filter(x=>x.recurrence_series_id===l.recurrence_series_id&&x.status==='assigned'&&new Date(x.scheduled_at)>=new Date(l.scheduled_at)).map(x=>x.id);
        if(ids.length){
          const {error}=await sb.from('lessons').delete().in('id',ids);if(error)throw error;
        }
        m.remove();await rerenderScheduleFromServer(infinite?'Бессрочная серия остановлена':'Будущие занятия серии удалены');
      }catch(err){fail(err)}
    };
  }

  async function enhanceScheduleWorkspace() {
    if(S.access||S.view!=='schedule'||document.querySelector('#mrScheduleEnhanced'))return;
    const content=document.querySelector('.content');if(!content)return;
    const top=content.querySelector('.topbar');
    [...content.children].forEach(el=>{if(el!==top)el.classList.add('mr-schedule-legacy')});
    const root=document.createElement('section');root.id='mrScheduleEnhanced';root.className='mr-schedule-enhanced';
    if(top)top.insertAdjacentElement('afterend',root);else content.prepend(root);
    try{
      await materializeRecurringLessons();
      await loadScheduleRules();
      const {data,error}=await sb.from('lessons').select('*,students(name,grade),topics(title)').order('scheduled_at',{ascending:true});
      if(error)throw error;
      S.lessons=data||S.lessons;
    }catch(e){console.warn('[Mathroom schedule prepare]',e)}
    renderEnhancedSchedule(root);
  }



  // Iteration 14 — teacher workday, reminders, attendance and workload analytics.
  const attendanceLabels = {
    unmarked: ['Не отмечено',''],
    present: ['Был','ok'],
    late: ['Опоздал','warn'],
    absent: ['Неявка','bad']
  };
  function attendanceMeta(value){ return attendanceLabels[value || 'unmarked'] || attendanceLabels.unmarked; }
  function isClosedForOperations(l){ return l.status==='completed' || l.status==='cancelled' || ['present','late','absent'].includes(l.attendance_status); }
  function lessonMinutesActual(l){
    if(l.status==='cancelled' || l.attendance_status==='absent') return 0;
    if(Number(l.actual_duration_minutes)>0) return Number(l.actual_duration_minutes);
    if(l.status==='completed' || ['present','late'].includes(l.attendance_status)) return Number(l.duration_minutes||0);
    return 0;
  }
  function todayBounds(){ const a=new Date();a.setHours(0,0,0,0);const b=new Date(a);b.setDate(b.getDate()+1);return [a,b]; }
  function lessonIsToday(l){ const [a,b]=todayBounds(),t=new Date(l.scheduled_at);return t>=a&&t<b; }
  function pastUnmarked(l){ return l.status!=='cancelled' && !['present','late','absent'].includes(l.attendance_status) && new Date(l.scheduled_at).getTime()+Number(l.duration_minutes||60)*60000 < Date.now(); }

  async function setAttendance(lessonId, status, note='', actualMinutes=null){
    const lesson=S.lessons.find(x=>x.id===lessonId);
    const body={attendance_status:status,attendance_note:note||'',attendance_marked_at:new Date().toISOString()};
    if(actualMinutes!=null && Number.isFinite(Number(actualMinutes))) body.actual_duration_minutes=Math.max(0,Math.round(Number(actualMinutes)));
    const {error}=await sb.from('lessons').update(body).eq('id',lessonId); if(error) throw error;
    if(lesson){ Object.assign(lesson,body); }
    try{
      if(lesson?.student_id) await appendLessonEvents({role:'teacher',lessonId,studentId:lesson.student_id},[{kind:'attendance',title:`Посещаемость: ${attendanceMeta(status)[0]}`,details:{status,note,actual_minutes:body.actual_duration_minutes??null}}]);
    }catch{}
    window.dispatchEvent(new Event('mathroom:attendance-updated'));
  }

  async function openAttendanceModal(lessonId){
    const l=S.lessons.find(x=>x.id===lessonId); if(!l)return;
    const current=l.attendance_status||'unmarked';
    const m=modal(`<h2>Посещаемость</h2><p class="muted">${esc(lessonStudentName(l))} · ${dateLong(l.scheduled_at)} · ${esc(lessonTopicName(l))}</p>
      <div class="mr-attendance-choice">
        <button class="btn ${current==='present'?'primary':''}" data-att-value="present">✓ Был</button>
        <button class="btn ${current==='late'?'primary':''}" data-att-value="late">◷ Опоздал</button>
        <button class="btn ${current==='absent'?'danger':''}" data-att-value="absent">× Неявка</button>
        <button class="btn" data-att-value="unmarked">Сбросить</button>
      </div>
      <div class="grid cols2"><div class="field"><label>Фактическая длительность, мин</label><input id="mrAttendanceMinutes" type="number" min="0" step="5" value="${Number(l.actual_duration_minutes||l.duration_minutes||60)}"></div><div class="field"><label>Заметка</label><input id="mrAttendanceNote" value="${esc(l.attendance_note||'')}" placeholder="например: подключился на 10 минут позже"></div></div>
      <div class="notice">Отметка посещаемости не удаляет урок и не меняет его учебные материалы. Неявку можно исправить позднее.</div>`,'wide-modal');
    m.querySelectorAll('[data-att-value]').forEach(btn=>btn.onclick=async()=>{
      try{
        const val=btn.dataset.attValue;
        const mins=val==='absent'||val==='unmarked'?0:Number(m.querySelector('#mrAttendanceMinutes').value||0);
        await setAttendance(lessonId,val,m.querySelector('#mrAttendanceNote').value.trim(),mins);
        m.remove();
        if(S.view==='schedule') await rerenderScheduleFromServer('Посещаемость сохранена'); else { toast('Посещаемость сохранена'); scheduleSync(); }
      }catch(e){fail(e)}
    });
  }

  function decorateScheduleAttendance(root){
    root.querySelectorAll('[data-cal-lesson]').forEach(card=>{
      const id=card.dataset.calLesson,l=S.lessons.find(x=>x.id===id); if(!l||l.status==='cancelled')return;
      if(card.querySelector('[data-attendance-pill]'))return;
      const [label,cls]=attendanceMeta(l.attendance_status);
      const tags=card.querySelector('.mr-calendar-tags');
      if(tags){const pill=document.createElement('span');pill.dataset.attendancePill='1';pill.className=`pill ${cls}`;pill.textContent=`Посещение: ${label}`;tags.appendChild(pill)}
      const actions=card.querySelector('.mr-calendar-actions');
      if(actions){const b=document.createElement('button');b.className='btn sm';b.dataset.calAttendance=id;b.textContent='Посещаемость';b.onclick=()=>openAttendanceModal(id);actions.appendChild(b)}
    });
  }

  function operationsReminderData(){
    const now=Date.now();
    const reminders=[];
    (S.lessons||[]).filter(l=>l.status!=='cancelled').forEach(l=>{
      const t=new Date(l.scheduled_at).getTime(), delta=t-now;
      if(delta>=0&&delta<=30*60000) reminders.push({kind:'lesson',level:delta<=10*60000?'high':'normal',student_id:l.student_id,key:`lesson:${l.id}`,title:`Урок через ${Math.max(0,Math.ceil(delta/60000))} мин`,text:`${lessonStudentName(l)} · ${compactClock(l.scheduled_at)} · ${lessonTopicName(l)}`,lesson:l});
      if(pastUnmarked(l)&&lessonIsToday(l)) reminders.push({kind:'attendance',level:'normal',student_id:l.student_id,key:`attendance:${l.id}`,title:'Не отмечена посещаемость',text:`${lessonStudentName(l)} · ${compactClock(l.scheduled_at)}`,lesson:l});
    });
    (S.homeworks||[]).forEach(h=>{
      const st=(S.students||[]).find(x=>x.id===h.student_id),name=st?.name||'Ученик';
      if(h.status==='submitted') reminders.push({kind:'homework',level:'normal',student_id:h.student_id,key:`hw-review:${h.id}`,title:'ДЗ ждёт проверки',text:name,homework:h});
      if(['assigned','revision'].includes(h.status)&&h.due_at&&new Date(h.due_at).getTime()<now) reminders.push({kind:'homework',level:'high',student_id:h.student_id,key:`hw-overdue:${h.id}`,title:h.status==='revision'?'Доработка просрочена':'ДЗ просрочено',text:name,homework:h});
    });
    return reminders.slice(0,12);
  }

  function openLessonAnywhere(id){
    const direct=document.querySelector(`[data-open-lesson="${CSS.escape(id)}"]`); if(direct){direct.click();return}
    const nav=document.querySelector('[data-nav="schedule"]'); if(nav){nav.click();setTimeout(()=>{const b=document.querySelector(`[data-open-lesson="${CSS.escape(id)}"]`);if(b)b.click();else toast('Открой урок из расписания')},180)}
  }

  async function requestBrowserReminders(){
    if(!('Notification' in window)) return toast('Этот браузер не поддерживает системные уведомления');
    const result=await Notification.requestPermission();
    localStorage.setItem('mathroom.browser.reminders',result==='granted'?'1':'0');
    toast(result==='granted'?'Уведомления включены':'Разрешение на уведомления не выдано');
  }

  function browserReminderTick(){
    if(localStorage.getItem('mathroom.browser.reminders')!=='1'||!('Notification' in window)||Notification.permission!=='granted'||document.hidden===false)return;
    const now=Date.now();
    (S.lessons||[]).filter(l=>l.status!=='cancelled'&&!isClosedForOperations(l)).forEach(l=>{
      const delta=new Date(l.scheduled_at).getTime()-now;
      if(delta<0||delta>15*60000)return;
      const key=`mathroom.notified.${l.id}.${new Date(l.scheduled_at).toISOString().slice(0,16)}`;
      if(localStorage.getItem(key))return;
      localStorage.setItem(key,'1');
      try{new Notification(`Mathroom · урок через ${Math.max(1,Math.ceil(delta/60000))} мин`,{body:`${lessonStudentName(l)} · ${lessonTopicName(l)}`,tag:`mathroom-${l.id}`})}catch{}
    });
  }
  setInterval(browserReminderTick,60000);
  window.addEventListener('mathroom:attendance-updated',()=>{document.querySelector('#mrTeacherWorkday')?.remove();document.querySelector('#mrTeacherActionCenter')?.remove();document.querySelector('#mrAttendanceProfile')?.remove();scheduleSync();});

  function workloadWindow(weeks=8){
    const end=new Date();end.setHours(23,59,59,999);const start=startOfLocalWeek(new Date(end));start.setDate(start.getDate()-(weeks-1)*7);
    const rows=[];
    for(let i=0;i<weeks;i++){const a=new Date(start);a.setDate(a.getDate()+i*7);const b=new Date(a);b.setDate(b.getDate()+7);const lessons=(S.lessons||[]).filter(l=>{const t=new Date(l.scheduled_at);return t>=a&&t<b});const planned=lessons.filter(l=>l.status!=='cancelled').reduce((s,l)=>s+Number(l.duration_minutes||0),0);const actual=lessons.reduce((s,l)=>s+lessonMinutesActual(l),0);const conducted=lessons.filter(l=>l.status==='completed'||['present','late'].includes(l.attendance_status)).length;const absent=lessons.filter(l=>l.attendance_status==='absent').length;rows.push({a,b,lessons,planned,actual,conducted,absent,cancelled:lessons.filter(l=>l.status==='cancelled').length,moved:lessons.filter(l=>l.rescheduled_from&&Math.abs(new Date(l.rescheduled_from)-new Date(l.scheduled_at))>60000).length})}
    return rows;
  }

  function openWorkloadAnalytics(){
    const rows=workloadWindow(12),all=rows.flatMap(x=>x.lessons),conducted=all.filter(l=>l.status==='completed'||['present','late'].includes(l.attendance_status)),attended=all.filter(l=>['present','late'].includes(l.attendance_status)).length,absent=all.filter(l=>l.attendance_status==='absent').length,attendanceBase=attended+absent,actual=rows.reduce((s,x)=>s+x.actual,0),planned=rows.reduce((s,x)=>s+x.planned,0),max=Math.max(60,...rows.map(x=>x.actual));
    const m=modal(`<div class="mr-card-head"><div><h2>Загрузка преподавателя</h2><p class="muted">Последние 12 недель · план и фактически проведённое время.</p></div></div>
      <div class="grid cols4 mr-ops-metrics"><div class="card"><div class="muted">Проведено</div><div class="metric">${conducted.length}</div></div><div class="card"><div class="muted">Факт. часов</div><div class="metric">${(actual/60).toFixed(1)}</div></div><div class="card"><div class="muted">План. часов</div><div class="metric">${(planned/60).toFixed(1)}</div></div><div class="card"><div class="muted">Посещаемость</div><div class="metric">${attendanceBase?Math.round(attended*100/attendanceBase)+'%':'—'}</div></div></div>
      <div class="mr-workload-chart">${rows.map(r=>`<div class="mr-workload-col"><span>${(r.actual/60).toFixed(1)}ч</span><div><i style="height:${Math.max(3,Math.round(r.actual/max*100))}%"></i><em style="height:${Math.max(3,Math.round(r.planned/max*100))}%"></em></div><small>${r.a.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</small></div>`).join('')}</div>
      <div class="small muted">Тёмная колонка — фактически проведённое время, контур — запланированное. Неявки: ${absent} · отмены: ${all.filter(l=>l.status==='cancelled').length} · переносы: ${all.filter(l=>l.rescheduled_from&&Math.abs(new Date(l.rescheduled_from)-new Date(l.scheduled_at))>60000).length}.</div>`,'wide-modal');
  }

  async function enhanceTeacherOperationsDashboard(){
    if(S.access||S.view!=='dashboard'||document.querySelector('#mrTeacherWorkday'))return;
    const content=document.querySelector('.content');if(!content)return;
    const [a,b]=todayBounds(),today=(S.lessons||[]).filter(l=>{const t=new Date(l.scheduled_at);return t>=a&&t<b}).sort((x,y)=>new Date(x.scheduled_at)-new Date(y.scheduled_at));
    const active=today.filter(l=>l.status!=='cancelled'),remaining=active.filter(l=>!isClosedForOperations(l)&&new Date(l.scheduled_at).getTime()+Number(l.duration_minutes||60)*60000>Date.now()),next=remaining[0]||null,mins=active.reduce((s,l)=>s+Number(l.duration_minutes||0),0),unmarked=today.filter(pastUnmarked).length;
    const reminders=operationsReminderData();
    const nextPlan=next?await getLessonPlan(next.id).catch(()=>null):null, mediaReady=recentMediaSelfCheck();
    const box=document.createElement('section');box.id='mrTeacherWorkday';box.className='card mr-workday';
    box.innerHTML=`<div class="mr-card-head"><div><h2>Рабочий день</h2><p class="small muted">${new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</p></div><div class="actions"><button class="btn sm" id="mrDeviceCheck">Проверка связи</button><button class="btn sm" id="mrEnableNotifications">${localStorage.getItem('mathroom.browser.reminders')==='1'?'Уведомления ✓':'Включить уведомления'}</button><button class="btn sm" id="mrOpenWorkload">Статистика загрузки</button></div></div>
      <div class="grid cols4 mr-ops-metrics"><div><small>Сегодня</small><b>${active.length}</b><span>уроков · ${Math.floor(mins/60)}ч ${mins%60}м</span></div><div><small>Осталось</small><b>${remaining.length}</b><span>${next?`ближайший ${compactClock(next.scheduled_at)}`:'день завершён'}</span></div><div><small>Посещаемость</small><b>${unmarked}</b><span>${unmarked?'нужно отметить':'всё отмечено'}</span></div><div><small>Напоминания</small><b>${reminders.length}</b><span>требуют внимания</span></div></div>
      ${next?`<div class="mr-next-lesson mr-next-lesson-ready"><div class="mr-next-main"><div class="actions"><span class="pill">Следующий урок</span><span class="pill ${nextPlan?.prep_status==='ready'?'good':'warn'}">${nextPlan?.prep_status==='ready'?'Подготовлен ✓':'Нужна подготовка'}</span><span class="pill ${mediaReady?'good':'warn'}" data-media-ready-state>${mediaReady?'Проверено ✓':'Нужно проверить'}</span></div><h3>${esc(lessonStudentName(next))}</h3><p>${compactClock(next.scheduled_at)} · ${esc(lessonTopicName(next))}</p><div class="mr-live-countdown" data-live-countdown="${esc(next.scheduled_at)}">${esc(liveCountdownText(next.scheduled_at))}</div></div><div class="actions mr-next-actions"><button class="btn primary" data-ops-open-lesson="${next.id}">Открыть урок</button><button class="btn" data-ops-prepare="${next.id}">Подготовить</button><button class="btn" data-ops-att="${next.id}">Посещаемость</button></div></div>`:''}
      <div class="mr-reminder-list">${reminders.length?reminders.map(r=>`<div class="mr-reminder ${r.level==='high'?'high':''}"><span>${r.kind==='lesson'?'◷':r.kind==='attendance'?'●':'✓'}</span><div><b>${esc(r.title)}</b><small>${esc(r.text)}</small></div>${r.lesson?`<button class="btn xs" data-ops-${r.kind==='attendance'?'att':'open-lesson'}="${r.lesson.id}">${r.kind==='attendance'?'Отметить':'Открыть'}</button>`:''}</div>`).join(''):'<div class="empty">Срочных напоминаний нет.</div>'}</div>`;
    const prep=document.querySelector('#mrPreparationCenter'); if(prep)prep.insertAdjacentElement('beforebegin',box); else {const top=content.querySelector('.topbar');if(top)top.insertAdjacentElement('afterend',box);else content.prepend(box)}
    box.querySelector('#mrDeviceCheck').onclick=openMediaSelfCheck;
    box.querySelector('#mrEnableNotifications').onclick=requestBrowserReminders;
    box.querySelector('#mrOpenWorkload').onclick=openWorkloadAnalytics;
    box.querySelectorAll('[data-ops-open-lesson]').forEach(b=>b.onclick=()=>openLessonAnywhere(b.dataset.opsOpenLesson));
    box.querySelectorAll('[data-ops-prepare]').forEach(b=>b.onclick=()=>openLessonPreparation(b.dataset.opsPrepare));
    box.querySelectorAll('[data-ops-att]').forEach(b=>b.onclick=()=>openAttendanceModal(b.dataset.opsAtt));
    paintLiveCountdowns();
  }

  async function enhanceStudentAttendanceProfile(){
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrAttendanceProfile'))return;
    const content=document.querySelector('.content');if(!content)return;
    const since=Date.now()-90*86400000, rows=(S.lessons||[]).filter(l=>l.student_id===S.selectedStudent&&new Date(l.scheduled_at).getTime()>=since&&l.status!=='cancelled');
    const present=rows.filter(l=>l.attendance_status==='present').length,late=rows.filter(l=>l.attendance_status==='late').length,absent=rows.filter(l=>l.attendance_status==='absent').length,base=present+late+absent,unmarked=rows.filter(pastUnmarked).length;
    const box=document.createElement('section');box.id='mrAttendanceProfile';box.className='card mr-attendance-profile';box.innerHTML=`<div class="mr-card-head"><div><h2>Посещаемость</h2><p class="small muted">Последние 90 дней</p></div></div><div class="grid cols4 mr-ops-metrics"><div><small>Был</small><b>${present}</b></div><div><small>Опоздания</small><b>${late}</b></div><div><small>Неявки</small><b>${absent}</b></div><div><small>Посещаемость</small><b>${base?Math.round((present+late)*100/base)+'%':'—'}</b></div></div>${unmarked?`<div class="notice">Есть уроков без отметки посещаемости: <b>${unmarked}</b>.</div>`:''}`;
    const target=document.querySelector('#mrGoalsOverview')||content.querySelector('.profile-metrics')||content.querySelector('.grid.cols4');if(target)target.insertAdjacentElement('afterend',box);else content.prepend(box);
  }


  // Iteration 15 — communication, shared materials and student lesson check-ins.
  let commsCache = { at: 0, studentId: '', questions: [], resources: [], checkins: [] };
  const commsFresh = (sid='') => commsCache.studentId===sid && Date.now()-commsCache.at < 15000;

  async function loadTeacherComms(studentId='', force=false){
    if(!force && commsFresh(studentId)) return commsCache;
    let q1=sb.from('student_questions').select('*,students(name,grade),topics(title)').eq('teacher_id',S.user.id).order('created_at',{ascending:false}).limit(80);
    let q2=sb.from('student_resources').select('*,students(name,grade),topics(title)').eq('teacher_id',S.user.id).order('pinned',{ascending:false}).order('created_at',{ascending:false}).limit(120);
    let q3=sb.from('student_lesson_checkins').select('*,students(name,grade),lessons(scheduled_at,topic_id,topics(title))').eq('teacher_id',S.user.id).order('created_at',{ascending:false}).limit(100);
    if(studentId){ q1=q1.eq('student_id',studentId); q2=q2.eq('student_id',studentId); q3=q3.eq('student_id',studentId); }
    const [a,b,c]=await Promise.all([q1,q2,q3]);
    const err=a.error||b.error||c.error; if(err) throw err;
    commsCache={at:Date.now(),studentId,questions:a.data||[],resources:b.data||[],checkins:c.data||[]};
    return commsCache;
  }
  function invalidateComms(){ commsCache.at=0; }
  const confidenceMeta = n => Number(n)<=2?['Сложно','bad']:Number(n)===3?['Нормально','warn']:['Уверенно','good'];
  function safeResourceUrl(raw){ try{ const u=new URL(String(raw||''),location.href); return ['http:','https:'].includes(u.protocol)?u.href:''; }catch{return ''} }

  async function openTeacherQuestions(studentId=''){
    try{
      const d=await loadTeacherComms(studentId,true); const rows=d.questions;
      const student=studentId?(S.students||[]).find(x=>x.id===studentId):null;
      const m=modal(`<div class="mr-card-head"><div><h2>${student?`Вопросы · ${esc(student.name)}`:'Вопросы учеников'}</h2><p class="muted">Вопросы между уроками. Ответ видит только соответствующий ученик.</p></div><span class="pill">открыто ${rows.filter(x=>x.status!=='resolved').length}</span></div>
        <div class="mr-question-list">${rows.length?rows.map(q=>`<article class="mr-question ${q.status==='resolved'?'resolved':''}" data-q-card="${q.id}">
          <div class="mr-question-head"><div><b>${esc(q.students?.name||student?.name||'Ученик')}</b><small>${new Date(q.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${q.topics?.title?` · ${esc(q.topics.title)}`:''}</small></div><span class="pill ${q.status==='resolved'?'good':q.teacher_reply?'warn':''}">${q.status==='resolved'?'закрыт':q.teacher_reply?'отвечено':'новый'}</span></div>
          <div class="mr-question-text">${nl(q.question)}</div>
          <div class="field"><label>Ответ преподавателя</label><textarea rows="3" data-q-reply="${q.id}" placeholder="Короткий ответ или что разобрать на следующем уроке">${esc(q.teacher_reply||'')}</textarea></div>
          <div class="actions"><button class="btn sm primary" data-q-save="${q.id}">Сохранить ответ</button><button class="btn sm" data-q-resolve="${q.id}">${q.status==='resolved'?'Вернуть в открытые':'Закрыть вопрос'}</button></div>
        </article>`).join(''):'<div class="empty">Вопросов пока нет.</div>'}</div>`,'wide-modal');
      m.querySelectorAll('[data-q-save]').forEach(b=>b.onclick=async()=>{try{const id=b.dataset.qSave,reply=m.querySelector(`[data-q-reply="${id}"]`).value.trim();const body={teacher_reply:reply,replied_at:reply?new Date().toISOString():null,updated_at:new Date().toISOString(),status:reply?'answered':'open'};const {error}=await sb.from('student_questions').update(body).eq('id',id);if(error)throw error;invalidateComms();document.querySelector('#mrTeacherActionCenter')?.remove();toast('Ответ сохранён');m.remove();openTeacherQuestions(studentId);scheduleSync()}catch(e){fail(e)}});
      m.querySelectorAll('[data-q-resolve]').forEach(b=>b.onclick=async()=>{try{const q=rows.find(x=>x.id===b.dataset.qResolve);const closing=q?.status!=='resolved';const {error}=await sb.from('student_questions').update({status:closing?'resolved':(q?.teacher_reply?'answered':'open'),resolved_at:closing?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',b.dataset.qResolve);if(error)throw error;invalidateComms();document.querySelector('#mrTeacherActionCenter')?.remove();m.remove();openTeacherQuestions(studentId);scheduleSync()}catch(e){fail(e)}});
    }catch(e){fail(e)}
  }

  async function openResourceManager(studentId){
    const st=(S.students||[]).find(x=>x.id===studentId); if(!st)return;
    try{
      const d=await loadTeacherComms(studentId,true); const rows=d.resources;
      const topicOptions=(S.topics||[]).filter(t=>!st.grade||Number(t.grade)===Number(st.grade)).map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join('');
      const m=modal(`<div class="mr-card-head"><div><h2>Материалы · ${esc(st.name)}</h2><p class="muted">Ссылки и заметки, которые ученик увидит в личном кабинете.</p></div><span class="pill">${rows.filter(x=>x.visible_to_student!==false).length} опубликовано</span></div>
        <form id="mrResourceForm" class="card mr-resource-form"><div class="grid cols2"><div class="field"><label>Название</label><input id="mrResTitle" required placeholder="Формулы сокращённого умножения"></div><div class="field"><label>Тип</label><select id="mrResKind"><option value="link">Ссылка</option><option value="note">Заметка</option></select></div></div><div class="grid cols2"><div class="field"><label>Тема</label><select id="mrResTopic"><option value="">Без привязки</option>${topicOptions}</select></div><div class="field"><label>Ссылка</label><input id="mrResUrl" type="url" placeholder="https://..."></div></div><div class="field"><label>Комментарий / текст</label><textarea id="mrResBody" rows="3" placeholder="Что посмотреть или на что обратить внимание"></textarea></div><div class="actions"><label class="mr-inline-check"><input id="mrResPinned" type="checkbox"> закрепить</label><button class="btn primary">Добавить материал</button></div></form>
        <div class="mr-resource-list">${rows.length?rows.map(r=>`<article class="mr-resource-row ${r.visible_to_student===false?'muted-row':''}"><div><div class="actions"><span class="pill">${r.kind==='link'?'ссылка':'заметка'}</span>${r.pinned?'<span class="pill good">закреплено</span>':''}${r.student_opened_at?'<span class="pill">открывал</span>':''}</div><b>${esc(r.title)}</b><small>${esc(r.topics?.title||'Без темы')} · ${new Date(r.created_at).toLocaleDateString('ru-RU')}</small>${safeResourceUrl(r.url)?`<a href="${esc(safeResourceUrl(r.url))}" target="_blank" rel="noopener">${esc(r.url)}</a>`:''}${r.body?`<p>${nl(r.body)}</p>`:''}</div><div class="actions"><button class="btn xs" data-res-pin="${r.id}">${r.pinned?'Открепить':'Закрепить'}</button><button class="btn xs" data-res-vis="${r.id}">${r.visible_to_student===false?'Показать':'Скрыть'}</button><button class="btn xs danger" data-res-del="${r.id}">Удалить</button></div></article>`).join(''):'<div class="empty">Материалов ещё нет.</div>'}</div>`,'wide-modal');
      m.querySelector('#mrResourceForm').onsubmit=async e=>{e.preventDefault();try{const kind=m.querySelector('#mrResKind').value,url=m.querySelector('#mrResUrl').value.trim(),body=m.querySelector('#mrResBody').value.trim(),safeUrl=safeResourceUrl(url);if(kind==='link'&&!safeUrl)return toast('Укажи корректную http/https ссылку');const payload={teacher_id:S.user.id,student_id:studentId,topic_id:m.querySelector('#mrResTopic').value||null,title:m.querySelector('#mrResTitle').value.trim(),kind,url:kind==='link'?safeUrl:'',body,pinned:m.querySelector('#mrResPinned').checked,visible_to_student:true,updated_at:new Date().toISOString()};const {error}=await sb.from('student_resources').insert(payload);if(error)throw error;invalidateComms();m.remove();openResourceManager(studentId)}catch(err){fail(err)}};
      m.querySelectorAll('[data-res-pin]').forEach(b=>b.onclick=async()=>{const r=rows.find(x=>x.id===b.dataset.resPin);const {error}=await sb.from('student_resources').update({pinned:!r.pinned,updated_at:new Date().toISOString()}).eq('id',r.id);if(error)return fail(error);invalidateComms();m.remove();openResourceManager(studentId)});
      m.querySelectorAll('[data-res-vis]').forEach(b=>b.onclick=async()=>{const r=rows.find(x=>x.id===b.dataset.resVis);const {error}=await sb.from('student_resources').update({visible_to_student:r.visible_to_student===false,updated_at:new Date().toISOString()}).eq('id',r.id);if(error)return fail(error);invalidateComms();m.remove();openResourceManager(studentId)});
      m.querySelectorAll('[data-res-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Удалить материал?'))return;const {error}=await sb.from('student_resources').delete().eq('id',b.dataset.resDel);if(error)return fail(error);invalidateComms();m.remove();openResourceManager(studentId)});
    }catch(e){fail(e)}
  }

  async function enhanceTeacherCommunicationDashboard(){
    if(S.access||S.view!=='dashboard'||document.querySelector('#mrCommunicationInbox'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const d=await loadTeacherComms('',false); const open=d.questions.filter(x=>x.status!=='resolved'),low=d.checkins.filter(x=>Number(x.confidence)<=2 && Date.now()-new Date(x.created_at).getTime()<14*86400000);
      const box=document.createElement('section');box.id='mrCommunicationInbox';box.className='card mr-comms-dashboard';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Связь с учениками</h2><p class="small muted">Вопросы между уроками и сигналы самооценки.</p></div><button class="btn sm ${open.length?'primary':''}" id="mrOpenQuestions">Вопросы ${open.length?`· ${open.length}`:''}</button></div><div class="grid cols2"><div class="mr-comms-mini"><b>${open.length}</b><span>открытых вопросов</span>${open.slice(0,3).map(q=>`<button data-comms-student="${q.student_id}"><strong>${esc(q.students?.name||'Ученик')}</strong><small>${esc(String(q.question||'').slice(0,90))}</small></button>`).join('')}</div><div class="mr-comms-mini"><b>${low.length}</b><span>уроков с отметкой «сложно» за 14 дней</span>${low.slice(0,3).map(x=>`<button data-comms-profile="${x.student_id}"><strong>${esc(x.students?.name||'Ученик')}</strong><small>${esc(x.lessons?.topics?.title||'Урок')} · ${confidenceMeta(x.confidence)[0]}</small></button>`).join('')}</div></div>`;
      const work=document.querySelector('#mrAfterLessonFlow')||document.querySelector('#mrTeacherWorkday'); if(work)work.insertAdjacentElement('afterend',box); else content.prepend(box);
      box.querySelector('#mrOpenQuestions').onclick=()=>openTeacherQuestions('');
      box.querySelectorAll('[data-comms-student]').forEach(b=>b.onclick=()=>openTeacherQuestions(b.dataset.commsStudent));
      box.querySelectorAll('[data-comms-profile]').forEach(b=>b.onclick=()=>{const nav=document.querySelector('[data-nav="students"]');nav?.click();setTimeout(()=>document.querySelector(`[data-profile="${CSS.escape(b.dataset.commsProfile)}"]`)?.click(),100)});
    }catch(e){console.warn('[Mathroom communication dashboard]',e)}
  }

  async function enhanceTeacherStudentCommunication(){
    if(S.access||S.view!=='profile'||!S.selectedStudent||document.querySelector('#mrStudentCommunication'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const d=await loadTeacherComms(S.selectedStudent,false),open=d.questions.filter(x=>x.status!=='resolved'),recent=d.checkins.filter(x=>Date.now()-new Date(x.created_at).getTime()<90*86400000),avgConf=recent.length?Math.round(recent.reduce((s,x)=>s+Number(x.confidence||0),0)/recent.length*10)/10:null;
      const box=document.createElement('section');box.id='mrStudentCommunication';box.className='card mr-student-comms';box.innerHTML=`<div class="mr-card-head"><div><h2>Связь и материалы</h2><p class="small muted">Вопросы ученика, полезные материалы и самооценка после уроков.</p></div><div class="actions"><button class="btn sm" id="mrStudentQuestions">Вопросы ${open.length?`· ${open.length}`:''}</button><button class="btn sm primary" id="mrStudentResources">Материалы</button></div></div><div class="grid cols3 mr-comms-stats"><div><small>Открытых вопросов</small><b>${open.length}</b></div><div><small>Опубликовано материалов</small><b>${d.resources.filter(x=>x.visible_to_student!==false).length}</b></div><div><small>Самооценка за 90 дней</small><b>${avgConf==null?'—':avgConf+'/5'}</b></div></div>${recent.length?`<div class="mr-checkin-strip">${recent.slice(0,8).reverse().map(x=>{const [label,cls]=confidenceMeta(x.confidence);return`<span class="pill ${cls}" title="${esc(x.lessons?.topics?.title||'Урок')}${x.note?` · ${esc(x.note)}`:''}">${x.confidence}/5</span>`}).join('')}</div>`:''}`;
      const target=document.querySelector('#mrAttendanceProfile')||document.querySelector('#mrGoalsOverview')||content.querySelector('.profile-metrics');if(target)target.insertAdjacentElement('afterend',box);else content.prepend(box);
      box.querySelector('#mrStudentQuestions').onclick=()=>openTeacherQuestions(S.selectedStudent);
      box.querySelector('#mrStudentResources').onclick=()=>openResourceManager(S.selectedStudent);
    }catch(e){console.warn('[Mathroom student communication]',e)}
  }

  async function openStudentQuestionComposer(){
    const m=modal(`<h2>Задать вопрос преподавателю</h2><p class="muted">Можно отправить вопрос между уроками. Не добавляй сюда пароли или другие чувствительные данные.</p><form id="mrStudentQuestionForm"><div class="field"><label>Вопрос</label><textarea id="mrStudentQuestionText" rows="5" maxlength="2000" required placeholder="Например: я не понимаю, почему здесь меняется знак…"></textarea></div><button class="btn primary">Отправить вопрос</button></form>`);
    m.querySelector('#mrStudentQuestionForm').onsubmit=async e=>{e.preventDefault();try{const question=m.querySelector('#mrStudentQuestionText').value.trim();if(!question)return;const {error}=await sb.rpc('create_my_question',{p_student_id:S.student.id,p_question:question});if(error)throw error;toast('Вопрос отправлен');m.remove();document.querySelector('#mrStudentCommunicationPanel')?.remove();scheduleSync()}catch(err){fail(err)}};
  }

  async function openStudentCheckin(lessonId){
    const m=modal(`<h2>Как прошёл урок?</h2><p class="muted">Это короткая самооценка для тебя и преподавателя. Здесь нет правильного ответа.</p><form id="mrCheckinForm"><div class="mr-confidence-buttons">${[[1,'Очень сложно'],[2,'Сложно'],[3,'Нормально'],[4,'Понятно'],[5,'Уверенно']].map(([n,t])=>`<label><input type="radio" name="confidence" value="${n}" ${n===3?'checked':''}><span><b>${n}/5</b><small>${t}</small></span></label>`).join('')}</div><div class="field"><label>Что хочется разобрать ещё? <span class="muted">необязательно</span></label><textarea id="mrCheckinNote" rows="3" maxlength="1000"></textarea></div><button class="btn primary">Сохранить</button></form>`,'wide-modal');
    m.querySelector('#mrCheckinForm').onsubmit=async e=>{e.preventDefault();try{const confidence=Number(m.querySelector('input[name="confidence"]:checked').value),note=m.querySelector('#mrCheckinNote').value.trim();const {error}=await sb.rpc('save_my_lesson_checkin',{p_lesson_id:lessonId,p_confidence:confidence,p_note:note});if(error)throw error;toast('Спасибо, самооценка сохранена');m.remove();document.querySelector('#mrStudentCommunicationPanel')?.remove();const today=document.querySelector('#mrStudentToday');if(today)today.dataset.ready='';scheduleSync()}catch(err){fail(err)}};
  }

  async function enhanceStudentCommunication(){
    if(!S.access||!S.student)return;
    const tabs=document.querySelector('.student-top .tabs');
    if(tabs&&!document.querySelector('#mrAskTeacher')){const b=document.createElement('button');b.id='mrAskTeacher';b.textContent='Задать вопрос';b.onclick=openStudentQuestionComposer;tabs.appendChild(b)}
    if(S.studentTab!=='progress'||document.querySelector('#mrStudentCommunicationPanel'))return;
    const content=document.querySelector('#studentContent');if(!content)return;
    try{
      const [q,r,c,l]=await Promise.all([sb.rpc('get_my_questions'),sb.rpc('get_my_resources'),sb.rpc('get_my_lesson_checkins'),sb.rpc('get_my_lessons')]); const err=q.error||r.error||c.error||l.error;if(err)throw err;
      const questions=Array.isArray(q.data)?q.data:[],resources=Array.isArray(r.data)?r.data:[],checkins=Array.isArray(c.data)?c.data:[],lessons=Array.isArray(l.data)?l.data:[];
      const completed=lessons.filter(x=>x.status==='completed').sort((a,b)=>String(b.completed_at||b.scheduled_at||'').localeCompare(String(a.completed_at||a.scheduled_at||'')));
      const missing=completed.find(x=>!checkins.some(c=>c.lesson_id===x.id));
      const box=document.createElement('section');box.id='mrStudentCommunicationPanel';box.className='mr-student-communication-panel';box.innerHTML=`${missing?`<div class="card mr-checkin-callout"><div><span class="pill">после урока</span><h2>Как прошло последнее занятие?</h2><p>${esc(missing.topics?.title||'Урок')} · ${dateLong(missing.scheduled_at)}</p></div><button class="btn primary" id="mrRateLastLesson">Оценить</button></div>`:''}<div class="grid cols2"><div class="card"><div class="mr-card-head"><div><h2>Мои вопросы</h2><p class="small muted">Ответы преподавателя между уроками.</p></div><button class="btn sm" id="mrAskFromProgress">+ Вопрос</button></div><div class="mr-my-questions">${questions.length?questions.slice(0,8).map(x=>`<div class="mr-my-question"><div class="actions"><span class="pill ${x.status==='resolved'?'good':x.teacher_reply?'warn':''}">${x.status==='resolved'?'закрыт':x.teacher_reply?'есть ответ':'ожидает ответа'}</span><small>${new Date(x.created_at).toLocaleDateString('ru-RU')}</small></div><b>${esc(x.question)}</b>${x.teacher_reply?`<div class="notice"><b>Преподаватель:</b><br>${nl(x.teacher_reply)}</div>`:''}</div>`).join(''):'<div class="empty">Вопросов пока нет.</div>'}</div></div><div class="card"><div class="mr-card-head"><div><h2>Материалы</h2><p class="small muted">Ссылки и заметки от преподавателя.</p></div><span class="pill">${resources.length}</span></div><div class="mr-student-resources">${resources.length?resources.map(x=>`<article class="${x.pinned?'pinned':''}"><div class="actions"><span class="pill">${x.kind==='link'?'ссылка':'заметка'}</span>${x.pinned?'<span class="pill good">важное</span>':''}${x.topic_title?`<span class="pill">${esc(x.topic_title)}</span>`:''}</div><b>${esc(x.title)}</b>${x.body?`<p>${nl(x.body)}</p>`:''}${x.kind==='link'&&safeResourceUrl(x.url)?`<button class="btn sm" data-open-resource="${x.id}" data-url="${esc(safeResourceUrl(x.url))}">Открыть ссылку</button>`:''}</article>`).join(''):'<div class="empty">Материалов пока нет.</div>'}</div></div></div>`;
      content.appendChild(box);
      box.querySelector('#mrAskFromProgress')?.addEventListener('click',openStudentQuestionComposer);
      box.querySelector('#mrRateLastLesson')?.addEventListener('click',()=>openStudentCheckin(missing.id));
      box.querySelectorAll('[data-open-resource]').forEach(b=>b.onclick=async()=>{try{await sb.rpc('mark_my_resource_opened',{p_resource_id:b.dataset.openResource});window.open(b.dataset.url,'_blank','noopener')}catch(e){window.open(b.dataset.url,'_blank','noopener')}});
    }catch(e){console.warn('[Mathroom student communication]',e)}
  }


  // Iteration 18 — post-lesson closure: teacher wrap-up + student reflection on Today.
  function recentCompletedLessons(hours=36){
    const since=Date.now()-hours*3600000;
    return (S.lessons||[]).filter(l=>l.status==='completed'&&new Date(l.completed_at||l.scheduled_at||0).getTime()>=since).sort((a,b)=>new Date(b.completed_at||b.scheduled_at||0)-new Date(a.completed_at||a.scheduled_at||0)).slice(0,4);
  }

  async function openLessonWrapUp(lessonId){
    const lesson=(S.lessons||[]).find(x=>x.id===lessonId);if(!lesson)return;
    try{
      const [rr,hh,cc]=await Promise.all([
        sb.from('lesson_reports').select('*').eq('lesson_id',lessonId).maybeSingle(),
        sb.from('homeworks').select('id,title,status,due_at,score,created_at').eq('lesson_id',lessonId).order('created_at',{ascending:false}),
        sb.from('student_lesson_checkins').select('confidence,note,created_at').eq('lesson_id',lessonId).maybeSingle()
      ]);
      const err=rr.error||hh.error||cc.error;if(err)throw err;
      const report=rr.data||null,homeworks=hh.data||[],checkin=cc.data||null;
      const [confLabel,confClass]=checkin?confidenceMeta(checkin.confidence):['',''];
      const m=modal(`<div class="mr-card-head"><div><h2>Закрытие урока</h2><p class="muted">${esc(lessonStudentName(lesson))} · ${esc(lessonTopicName(lesson))} · ${dateLong(lesson.completed_at||lesson.scheduled_at)}</p></div><span class="pill good">урок завершён</span></div>
        <div class="grid cols3 mr-wrap-status"><div><small>Структурированный итог</small><b>${report?'сохранён ✓':'нет отчёта'}</b></div><div><small>Домашняя работа</small><b>${homeworks.length?`${homeworks.length} назначено`:'не назначена'}</b></div><div><small>Самооценка ученика</small><b>${checkin?`${checkin.confidence}/5 · ${esc(confLabel)}`:'ожидается'}</b></div></div>
        ${checkin?.note?`<div class="notice ${confClass==='bad'?'warn':''}"><b>Комментарий ученика</b><br>${nl(checkin.note)}</div>`:''}
        <div class="grid cols2"><div class="field"><label>Что получилось</label><textarea id="mrWrapHighlights" rows="4">${esc(report?.public_highlights||'')}</textarea></div><div class="field"><label>Что повторить</label><textarea id="mrWrapFocus" rows="4">${esc(report?.public_focus||'')}</textarea></div></div>
        <div class="field"><label>Итоги ученику</label><textarea id="mrWrapSummary" rows="4">${esc(lesson.public_summary||'')}</textarea></div>
        <div class="field"><label>К следующему уроку</label><textarea id="mrWrapPlan" rows="3">${esc(lesson.homework_plan||'')}</textarea></div>
        ${homeworks.length?`<div class="mr-wrap-homeworks"><b>Домашняя после урока</b>${homeworks.map(h=>`<div><span>${esc(h.title)}</span><small>${esc(statusLabel(h.status))}${h.due_at?` · срок ${new Date(h.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:''}${h.score!=null?` · ${h.score}%`:''}</small></div>`).join('')}</div>`:'<div class="notice">Домашняя к этому уроку не привязана. Это нормально, если закрепление не требуется.</div>'}
        <div class="actions mr-wrap-actions"><button class="btn primary" id="mrWrapSave">Сохранить итог</button><button class="btn" id="mrWrapParent">Отчёт родителю</button><button class="btn" id="mrWrapResources">Материалы ученику</button><button class="btn" id="mrWrapAssignments">Открыть задания</button></div>`,'wide-modal');
      m.querySelector('#mrWrapSave').onclick=async()=>{try{
        const public_summary=m.querySelector('#mrWrapSummary').value.trim(),homework_plan=m.querySelector('#mrWrapPlan').value.trim(),public_highlights=m.querySelector('#mrWrapHighlights').value.trim(),public_focus=m.querySelector('#mrWrapFocus').value.trim();
        const {error:le}=await sb.from('lessons').update({public_summary,homework_plan}).eq('id',lessonId);if(le)throw le;
        if(report){const {error:re}=await sb.from('lesson_reports').update({public_highlights,public_focus,updated_at:new Date().toISOString()}).eq('lesson_id',lessonId);if(re)throw re;}
        lesson.public_summary=public_summary;lesson.homework_plan=homework_plan;toast('Итог урока обновлён');document.querySelector('#mrAfterLessonFlow')?.remove();document.querySelector('#mrTeacherActionCenter')?.remove();scheduleSync();
      }catch(e){fail(e)}};
      m.querySelector('#mrWrapParent').onclick=()=>{m.remove();openLessonParentReport(lessonId)};
      m.querySelector('#mrWrapResources').onclick=()=>{m.remove();openResourceManager(lesson.student_id)};
      m.querySelector('#mrWrapAssignments').onclick=()=>{m.remove();document.querySelector('[data-nav="assignments"]')?.click()};
    }catch(e){fail(e)}
  }

  async function enhancePostLessonClosure(){
    if(S.access||S.view!=='dashboard'||document.querySelector('#mrAfterLessonFlow'))return;
    const rows=recentCompletedLessons(36);if(!rows.length)return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const ids=rows.map(x=>x.id),[rr,cc]=await Promise.all([
        sb.from('lesson_reports').select('lesson_id,public_highlights,public_focus').in('lesson_id',ids),
        sb.from('student_lesson_checkins').select('lesson_id,confidence,note,created_at').in('lesson_id',ids)
      ]);const err=rr.error||cc.error;if(err)throw err;
      const reports=rr.data||[],checkins=cc.data||[];
      const box=document.createElement('section');box.id='mrAfterLessonFlow';box.className='card mr-after-lesson';
      box.innerHTML=`<div class="mr-card-head"><div><h2>После урока</h2><p class="small muted">Быстро проверь, что итог занятия действительно закрыт.</p></div><span class="pill">последние 36 ч</span></div><div class="mr-after-list">${rows.map(l=>{const report=reports.find(x=>x.lesson_id===l.id),checkin=checkins.find(x=>x.lesson_id===l.id),hws=(S.homeworks||[]).filter(x=>x.lesson_id===l.id),att=attendanceMeta(l.attendance_status);return`<article><div class="mr-after-main"><small>${new Date(l.completed_at||l.scheduled_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small><b>${esc(lessonStudentName(l))} · ${esc(lessonTopicName(l))}</b><div class="actions"><span class="pill ${report?'good':'warn'}">${report?'итог ✓':'нет отчёта'}</span><span class="pill">${hws.length?`ДЗ ${hws.length}`:'без ДЗ'}</span><span class="pill ${checkin&&Number(checkin.confidence)<=2?'warn':''}">${checkin?`самооценка ${checkin.confidence}/5`:'самооценка ожидается'}</span><span class="pill ${att[1]}">${esc(att[0])}</span></div></div><div class="actions"><button class="btn sm primary" data-wrap-lesson="${l.id}">Закрыть хвосты</button><button class="btn sm" data-wrap-parent="${l.id}">Отчёт родителю</button></div></article>`}).join('')}</div>`;
      const work=document.querySelector('#mrTeacherWorkday');if(work)work.insertAdjacentElement('afterend',box);else content.prepend(box);
      box.querySelectorAll('[data-wrap-lesson]').forEach(b=>b.onclick=()=>openLessonWrapUp(b.dataset.wrapLesson));
      box.querySelectorAll('[data-wrap-parent]').forEach(b=>b.onclick=()=>openLessonParentReport(b.dataset.wrapParent));
    }catch(e){console.warn('[Mathroom post lesson]',e)}
  }



  // Iteration 16 — calm student “Today” workspace + pre-lesson device self-check.
  function studentTabGo(tab){
    const ids={today:'studentTodayTab',board:'studentBoardTab',tasks:'studentTasksTab',lessons:'studentLessonsTab',progress:'studentProgressTab'};
    const el=document.getElementById(ids[tab]||'');
    if(el){el.click();return}
    S.studentTab=tab;
  }

  function relativeStudentDate(value){
    if(!value)return 'не запланирован';
    const d=new Date(value),now=new Date(),a=new Date(now);a.setHours(0,0,0,0);const b=new Date(d);b.setHours(0,0,0,0);
    const days=Math.round((b-a)/86400000),time=d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    if(days===0)return `сегодня в ${time}`;
    if(days===1)return `завтра в ${time}`;
    if(days>1&&days<7)return `${d.toLocaleDateString('ru-RU',{weekday:'long'})} в ${time}`;
    return d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  }


  // Iteration 17 — pre-lesson readiness for both sides without adding new server data.
  function mediaReadyStorageKey(){
    const who=S.access?(S.student?.id||'student'):(S.user?.id||'teacher');
    return `mathroom.media.ready.${S.access?'student':'teacher'}.${who}`;
  }
  function markMediaSelfCheckReady(){
    try{localStorage.setItem(mediaReadyStorageKey(),String(Date.now()))}catch{}
    window.dispatchEvent(new CustomEvent('mathroom:device-ready',{detail:{at:Date.now()}}));
  }
  function clearMediaSelfCheckReady(){
    try{localStorage.removeItem(mediaReadyStorageKey())}catch{}
    window.dispatchEvent(new CustomEvent('mathroom:device-ready',{detail:{at:0}}));
  }
  function recentMediaSelfCheck(maxAgeMs=12*60*60*1000){
    try{const at=Number(localStorage.getItem(mediaReadyStorageKey())||0);return at>0&&Date.now()-at<=maxAgeMs}catch{return false}
  }
  function liveCountdownText(value){
    if(!value)return 'время не задано';
    const delta=new Date(value).getTime()-Date.now();
    if(!Number.isFinite(delta))return 'время не задано';
    if(delta<=-90*60000)return 'время занятия прошло';
    if(delta<=0)return 'можно подключаться сейчас';
    const mins=Math.ceil(delta/60000);
    if(mins<60)return `через ${mins} мин`;
    const hours=Math.floor(mins/60),rest=mins%60;
    if(hours<24)return `через ${hours} ч${rest?` ${rest} мин`:''}`;
    const days=Math.floor(hours/24),h=hours%24;
    return `через ${days} д${h?` ${h} ч`:''}`;
  }
  function paintLiveCountdowns(){
    document.querySelectorAll('[data-live-countdown]').forEach(el=>{el.textContent=liveCountdownText(el.dataset.liveCountdown)});
    const ready=recentMediaSelfCheck();
    document.querySelectorAll('[data-media-ready-state]').forEach(el=>{
      el.textContent=ready?'Проверено ✓':'Нужно проверить';
      el.classList.toggle('good',ready);
      el.classList.toggle('warn',!ready);
    });
    document.querySelectorAll('[data-preflight-device]').forEach(btn=>{
      btn.classList.toggle('done',ready);btn.classList.toggle('warn',!ready);
      const step=btn.querySelector(':scope > span');if(step)step.textContent=ready?'✓':'2';
    });
  }
  setInterval(paintLiveCountdowns,15000);
  window.addEventListener('mathroom:device-ready',paintLiveCountdowns);

  function closeMediaCheckResources(state){
    if(!state)return;
    try{state.stream?.getTracks?.().forEach(t=>t.stop())}catch{}
    try{if(state.raf)cancelAnimationFrame(state.raf)}catch{}
    try{state.audio?.close?.()}catch{}
    state.stream=null;state.raf=0;state.audio=null;
  }

  async function openMediaSelfCheck(){
    const state={stream:null,raf:0,audio:null};
    const m=modal(`<div class="mr-card-head"><div><h2>Проверка связи</h2><p class="muted">Камера и микрофон проверяются только в браузере. Видео и звук никуда не отправляются.</p></div><span class="pill" id="mrMediaSecure">${window.isSecureContext?'HTTPS ✓':'нужен HTTPS'}</span></div>
      <div class="mr-device-check-grid"><div class="mr-device-preview"><video id="mrDevicePreview" autoplay playsinline muted></video><div class="mr-device-empty" id="mrDeviceEmpty">Разреши доступ к камере и микрофону.</div></div><div class="card mr-device-status"><div><small>Камера</small><b id="mrCameraState">проверяем…</b></div><div><small>Микрофон</small><b id="mrMicState">проверяем…</b></div><div><small>Уровень микрофона</small><div class="mr-mic-meter"><i id="mrMicLevel"></i></div></div><div><small>Подсказка</small><span id="mrDeviceHint">Скажи несколько слов и посмотри, двигается ли индикатор.</span></div></div></div>
      <div class="notice" id="mrDeviceResult">Если браузер спросит разрешение — выбери «Разрешить».</div>`,'wide-modal');
    const cleanup=()=>closeMediaCheckResources(state);
    m.addEventListener('click',e=>{if(e.target===m||e.target.closest('[data-close]'))setTimeout(cleanup,0)});
    const obs=new MutationObserver(()=>{if(!document.body.contains(m)){cleanup();obs.disconnect()}});obs.observe(document.body,{childList:true});
    const cam=m.querySelector('#mrCameraState'),mic=m.querySelector('#mrMicState'),result=m.querySelector('#mrDeviceResult'),preview=m.querySelector('#mrDevicePreview'),empty=m.querySelector('#mrDeviceEmpty');
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){clearMediaSelfCheckReady();cam.textContent='недоступна';mic.textContent='недоступен';result.className='notice warn';result.textContent='Браузер не даёт доступ к камере/микрофону. Открой Mathroom по HTTPS в современном браузере.';return}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});state.stream=stream;if(!document.body.contains(m)){cleanup();return}
      preview.srcObject=stream;
      preview.style.setProperty('transform','none','important');
      empty.hidden=true;
      const videoTrack=stream.getVideoTracks()[0],audioTrack=stream.getAudioTracks()[0];
      cam.textContent=videoTrack?`готова · ${videoTrack.label||'камера'}`:'не найдена';
      mic.textContent=audioTrack?`готов · ${audioTrack.label||'микрофон'}`:'не найден';
      result.className='notice good';result.textContent=videoTrack&&audioTrack?'Устройство готово к уроку. Перед занятием останется включить видео в самой комнате.':'Проверь подключение нужного устройства.';
      if(videoTrack&&audioTrack)markMediaSelfCheckReady();
      if(audioTrack){
        try{
          const AC=window.AudioContext||window.webkitAudioContext;
          if(AC){
            const ac=new AC();state.audio=ac;
            const src=ac.createMediaStreamSource(new MediaStream([audioTrack]));
            const an=ac.createAnalyser();an.fftSize=256;src.connect(an);
            const data=new Uint8Array(an.frequencyBinCount),bar=m.querySelector('#mrMicLevel');
            const tick=()=>{
              if(!document.body.contains(m)||!state.stream)return;
              an.getByteFrequencyData(data);
              const avg=data.reduce((a,b)=>a+b,0)/Math.max(1,data.length);
              bar.style.width=`${Math.min(100,Math.round(avg*1.8))}%`;
              state.raf=requestAnimationFrame(tick);
            };
            tick();
          }
        }catch(e){console.info('[Mathroom device check] mic meter unavailable',e)}
      }
    }catch(e){
      clearMediaSelfCheckReady();
      console.warn('[Mathroom device check]',e);cam.textContent='нет доступа';mic.textContent='нет доступа';result.className='notice warn';
      result.textContent=e?.name==='NotAllowedError'?'Доступ к камере или микрофону запрещён. Разреши его в настройках сайта и запусти проверку ещё раз.':`Не удалось открыть устройства: ${e?.message||'проверь камеру и микрофон'}`;
    }
  }

  async function enhanceStudentToday(){
    if(!S.access||S.studentTab!=='today'||!S.student)return;
    const root=document.querySelector('#mrStudentToday');
    if(!root||root.dataset.ready==='1'||root.dataset.ready==='loading')return;
    root.dataset.ready='loading';
    try{
      const [l,h,t,rv,g,rep]=await Promise.all([
        sb.rpc('get_my_lessons'),
        sb.from('homeworks').select('id,title,status,score,due_at,revision_requested_at,revision_message,created_at,topics(title)').eq('student_id',S.student.id).order('created_at',{ascending:false}),
        sb.from('tests').select('id,title,status,score,created_at,topics(title)').eq('student_id',S.student.id).order('created_at',{ascending:false}),
        sb.rpc('get_my_review_items'),
        sb.rpc('get_my_goals'),
        sb.rpc('get_my_lesson_reports')
      ]);
      const err=l.error||h.error||t.error||rv.error||g.error||rep.error;
      if(err)throw err;
      if(S.studentTab!=='today'||!document.body.contains(root))return;

      const lessons=Array.isArray(l.data)?l.data:[],homeworks=h.data||[],tests=t.data||[];
      const review=Array.isArray(rv.data)?rv.data:[],goals=Array.isArray(g.data)?g.data:[],reports=Array.isArray(rep.data)?rep.data:[];
      const now=Date.now(),today=todayDay();
      const upcoming=lessons.filter(x=>x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=now-5*60000).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
      const next=upcoming[0]||null;
      const assignedHw=homeworks.filter(x=>x.status==='assigned');
      const revision=assignedHw.filter(x=>x.revision_requested_at);
      const overdue=assignedHw.filter(x=>x.due_at&&new Date(x.due_at).getTime()<now&&!x.revision_requested_at);
      const dueHw=assignedHw.filter(x=>!x.revision_requested_at).sort((a,b)=>new Date(a.due_at||'2999-12-31')-new Date(b.due_at||'2999-12-31'));
      const assignedTests=tests.filter(x=>x.status==='assigned');
      const dueReview=review.filter(x=>x.next_review_at&&x.next_review_at<=today).sort((a,b)=>Number(a.mastery||100)-Number(b.mastery||100));
      const activeGoals=goals.filter(x=>x.status==='active');
      const latestReport=[...reports].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null;

      let primary={kind:'clear',title:'К занятию всё спокойно',text:'Можно открыть доску заранее или посмотреть ближайшие задания.',button:'Открыть доску',tab:'board'};
      if(revision[0])primary={kind:'revision',title:'Есть домашняя на доработку',text:revision[0].title+(revision[0].revision_message?` · ${revision[0].revision_message}`:''),button:'Открыть задания',tab:'tasks'};
      else if(overdue[0])primary={kind:'overdue',title:'Есть просроченное задание',text:overdue[0].title,button:'Открыть задания',tab:'tasks'};
      else if(dueHw[0])primary={kind:'homework',title:'Следующее задание',text:`${dueHw[0].title}${dueHw[0].due_at?` · срок ${new Date(dueHw[0].due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:''}`,button:'Открыть задания',tab:'tasks'};
      else if(assignedTests[0])primary={kind:'test',title:'Есть назначенный тест',text:assignedTests[0].title,button:'Открыть задания',tab:'tasks'};
      else if(dueReview[0])primary={kind:'review',title:'Можно коротко повторить',text:`${dueReview[0].label} · ${Math.round(Number(dueReview[0].mastery||0))}%`,button:'Открыть прогресс',tab:'progress'};

      const focusItems=[
        ...revision.slice(0,2).map(x=>({type:'Доработка',title:x.title,meta:'нужно исправить',tab:'tasks',cls:'warn'})),
        ...overdue.slice(0,2).map(x=>({type:'Просрочено',title:x.title,meta:'лучше закрыть первым',tab:'tasks',cls:'warn'})),
        ...dueHw.filter(x=>!overdue.some(o=>o.id===x.id)).slice(0,3).map(x=>({type:'Домашняя',title:x.title,meta:x.due_at?`срок ${new Date(x.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:'без срока',tab:'tasks',cls:''})),
        ...assignedTests.slice(0,2).map(x=>({type:'Тест',title:x.title,meta:x.topics?.title||'',tab:'tasks',cls:''})),
        ...dueReview.slice(0,3).map(x=>({type:'Повторение',title:x.label,meta:`${Math.round(Number(x.mastery||0))}%`,tab:'progress',cls:Number(x.mastery)<60?'warn':''}))
      ].slice(0,5);

      const weekEnd=now+7*86400000,weekLessons=upcoming.filter(x=>new Date(x.scheduled_at).getTime()<=weekEnd).slice(0,5);
      const nextAt=next?new Date(next.scheduled_at).getTime():0;
      const preflightVisible=!!next&&nextAt-now<=36*60*60*1000&&nextAt-now>=-5*60000;
      const pendingBeforeLesson=next?assignedHw.filter(x=>!x.due_at||new Date(x.due_at).getTime()<=nextAt||x.revision_requested_at).length+assignedTests.length:0;
      const mediaReady=recentMediaSelfCheck();

      root.innerHTML=`<section class="card mr-today-hero ${primary.kind}"><div><span class="pill">подготовка к уроку</span><h2>${esc(primary.title)}</h2><p>${esc(primary.text)}</p><div class="actions"><button class="btn primary" id="mrTodayPrimary">${esc(primary.button)}</button></div></div><div class="mr-today-next"><small>Следующий урок</small><b>${next?esc(next.topics?.title||'Урок'):'Пока не назначен'}</b><span>${next?esc(relativeStudentDate(next.scheduled_at)):'Когда преподаватель добавит урок, он появится здесь.'}</span>${next?'<button class="btn sm" id="mrTodayDevice">Проверить камеру и микрофон</button>':''}</div></section>
        ${preflightVisible?`<section class="card mr-preflight"><div class="mr-card-head"><div><span class="pill">перед уроком</span><h2>Проверка перед занятием</h2><p class="small muted">${esc(next.topics?.title||'Урок')} · ${esc(relativeStudentDate(next.scheduled_at))}</p></div><div class="mr-preflight-countdown"><small>До старта</small><b data-live-countdown="${esc(next.scheduled_at)}">${esc(liveCountdownText(next.scheduled_at))}</b></div></div><div class="mr-preflight-steps"><button data-today-tab="tasks" class="${pendingBeforeLesson?'warn':'done'}"><span>${pendingBeforeLesson?'1':'✓'}</span><div><small>Задания</small><b>${pendingBeforeLesson?`Осталось: ${pendingBeforeLesson}`:'Хвостов нет'}</b><em>${pendingBeforeLesson?'Проверь задания перед уроком':'Можно переходить к уроку'}</em></div><strong>→</strong></button><button id="mrPreflightDevice" data-preflight-device class="${mediaReady?'done':'warn'}"><span>${mediaReady?'✓':'2'}</span><div><small>Камера и микрофон</small><b data-media-ready-state class="pill ${mediaReady?'good':'warn'}">${mediaReady?'Проверено ✓':'Нужно проверить'}</b><em>Тест выполняется только на этом устройстве</em></div><strong>→</strong></button><button data-today-tab="board"><span>3</span><div><small>Доска</small><b>Открыть рабочую доску</b><em>Можно зайти заранее</em></div><strong>→</strong></button></div></section>`:''}
        <div class="grid cols4 mr-today-metrics"><div class="card"><small>Заданий</small><b>${assignedHw.length+assignedTests.length}</b><span>сейчас назначено</span></div><div class="card"><small>Повторить</small><b>${dueReview.length}</b><span>тем сейчас</span></div><div class="card"><small>Уроков 7 дней</small><b>${weekLessons.length}</b><span>в расписании</span></div><div class="card"><small>Цели</small><b>${activeGoals.length}</b><span>активных</span></div></div>
        <div class="grid cols2 mr-today-grid"><section class="card"><div class="mr-card-head"><div><h2>Перед следующим уроком</h2><p class="small muted">Только то, что относится к занятию и подготовке.</p></div><button class="btn sm" data-today-tab="tasks">Все задания</button></div><div class="mr-today-actions">${focusItems.length?focusItems.map((x,i)=>`<button data-today-tab="${x.tab}" class="${x.cls}"><span>${i+1}</span><div><small>${esc(x.type)}</small><b>${esc(x.title)}</b><em>${esc(x.meta)}</em></div><strong>→</strong></button>`).join(''):'<div class="empty">Срочных учебных дел нет.</div>'}</div></section>
        <section class="card"><div class="mr-card-head"><div><h2>Ближайшие 7 дней</h2><p class="small muted">Только расписание занятий.</p></div><button class="btn sm" data-today-tab="lessons">Все уроки</button></div><div class="mr-week-plan">${weekLessons.length?weekLessons.map(x=>`<div><span>${new Date(x.scheduled_at).toLocaleDateString('ru-RU',{weekday:'short',day:'2-digit',month:'2-digit'})}</span><b>${esc(x.topics?.title||'Урок')}</b><small>${compactClock(x.scheduled_at)} · ${Number(x.duration_minutes||60)} мин</small></div>`).join(''):'<div class="empty">На ближайшую неделю уроки пока не стоят.</div>'}</div></section></div>
        <section class="card"><div class="mr-card-head"><div><h2>Последний итог урока</h2><p class="small muted">Короткая памятка по пройденному — без чатов и сообщений между занятиями.</p></div><button class="btn sm" data-today-tab="progress">Прогресс</button></div>${latestReport?`<div class="mr-today-report">${latestReport.public_highlights?`<div><span>Получилось</span><p>${nl(latestReport.public_highlights)}</p></div>`:''}${latestReport.public_focus?`<div><span>Повторить</span><p>${nl(latestReport.public_focus)}</p></div>`:''}${!latestReport.public_highlights&&!latestReport.public_focus?'<div class="empty">Комментарий появится после следующего урока.</div>':''}</div>`:'<div class="empty">После проведённого урока здесь может появиться короткий итог.</div>'}</section>`;

      root.dataset.ready='1';
      root.querySelector('#mrTodayPrimary').onclick=()=>studentTabGo(primary.tab);
      root.querySelector('#mrTodayDevice')?.addEventListener('click',openMediaSelfCheck);
      root.querySelector('#mrPreflightDevice')?.addEventListener('click',openMediaSelfCheck);
      root.querySelectorAll('[data-today-tab]').forEach(b=>b.onclick=()=>studentTabGo(b.dataset.todayTab));
      paintLiveCountdowns();
    }catch(e){
      console.warn('[Mathroom student today]',e);
      root.dataset.ready='error';
      root.innerHTML=`<div class="card"><h2>Сегодня</h2><div class="notice warn">Не удалось собрать сводку. Обнови страницу; остальные разделы кабинета продолжают работать.</div></div>`;
    }
  }



  // Iteration 20 — student-initiated schedule-change requests with teacher confirmation.
  const scheduleRequestCache={at:0,rows:[]};
  function invalidateScheduleRequests(){scheduleRequestCache.at=0;scheduleRequestCache.rows=[]}
  async function loadTeacherScheduleRequests(force=false){
    if(!S.user)return [];
    if(!force&&scheduleRequestCache.at&&Date.now()-scheduleRequestCache.at<15000)return scheduleRequestCache.rows;
    const {data,error}=await sb.from('student_schedule_requests')
      .select('*,students(name,grade),lessons(id,scheduled_at,duration_minutes,status,topic_id,topics(title))')
      .eq('teacher_id',S.user.id).order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    scheduleRequestCache.at=Date.now();scheduleRequestCache.rows=data||[];return scheduleRequestCache.rows;
  }
  async function loadMyScheduleRequests(){
    const {data,error}=await sb.rpc('get_my_schedule_requests');if(error)throw error;
    return Array.isArray(data)?data:[];
  }
  function scheduleRequestKindLabel(kind){return kind==='cancel'?'Отмена занятия':'Перенос занятия'}
  function scheduleRequestStatusMeta(status){
    return ({pending:['ожидает ответа','warn'],approved:['подтверждено','good'],declined:['не подтверждено','bad'],cancelled:['отозвано','']})[status]||[status||'—',''];
  }
  function scheduleRequestLesson(row){return row?.lessons||S.lessons?.find(x=>x.id===row?.lesson_id)||null}
  function scheduleRequestStudent(row){return row?.students||S.students?.find(x=>x.id===row?.student_id)||null}
  function scheduleRequestPreferredText(row){return row?.preferred_at?dateLong(row.preferred_at):'время не предложено'}

  async function openStudentScheduleRequest(lesson,existing=null){
    if(!lesson)return;
    if(existing?.status==='pending'){
      const m=modal(`<div class="mr-card-head"><div><h2>Запрос уже отправлен</h2><p class="muted">${esc(lesson.topics?.title||existing.topic_title||'Урок')} · ${esc(dateLong(lesson.scheduled_at))}</p></div><span class="pill warn">ожидает ответа</span></div><div class="mr-request-summary"><div><small>Что попросили</small><b>${esc(scheduleRequestKindLabel(existing.kind))}</b></div>${existing.kind==='reschedule'?`<div><small>Предпочтительное время</small><b>${esc(scheduleRequestPreferredText(existing))}</b></div>`:''}${existing.note?`<div><small>Комментарий</small><p>${nl(existing.note)}</p></div>`:''}</div><div class="notice">Пока преподаватель не подтвердил запрос, действующим остаётся текущее расписание.</div><div class="actions"><button class="btn danger" id="mrStudentRequestCancel">Отозвать запрос</button></div>`,'wide-modal');
      m.querySelector('#mrStudentRequestCancel').onclick=async()=>{try{const {data,error}=await sb.rpc('cancel_my_schedule_request',{p_request_id:existing.id});if(error)throw error;if(!data)return toast('Запрос уже обработан');m.remove();toast('Запрос отозван');document.querySelector('#mrStudentScheduleRequests')?.remove();document.querySelector('#mrStudentScheduleToday')?.remove();scheduleSync()}catch(e){fail(e)}};
      return;
    }
    const m=modal(`<div class="mr-card-head"><div><h2>Изменить ближайшее занятие</h2><p class="muted">${esc(lesson.topics?.title||'Урок')} · сейчас ${esc(dateLong(lesson.scheduled_at))}</p></div><span class="pill">запрос преподавателю</span></div><div class="notice"><b>Расписание не изменится автоматически.</b> Ты отправляешь запрос, а преподаватель подтверждает перенос или отмену.</div><form id="mrStudentScheduleRequestForm"><div class="mr-request-kind"><label><input type="radio" name="requestKind" value="reschedule" checked><span><b>Хочу перенести</b><small>Предложить другое время</small></span></label><label><input type="radio" name="requestKind" value="cancel"><span><b>Не смогу быть</b><small>Попросить отменить занятие</small></span></label></div><div class="field" id="mrStudentPreferredWrap"><label>Когда было бы удобно</label><input id="mrStudentPreferredAt" type="datetime-local"></div><div class="field"><label>Комментарий <span class="muted">необязательно</span></label><textarea id="mrStudentRequestNote" rows="3" maxlength="1000" placeholder="Например: в это время контрольная, смогу вечером после 18:00"></textarea></div><button class="btn primary">Отправить запрос</button></form>`,'wide-modal');
    const preferred=m.querySelector('#mrStudentPreferredWrap'),kindNow=()=>m.querySelector('input[name="requestKind"]:checked')?.value||'reschedule';
    m.querySelectorAll('input[name="requestKind"]').forEach(x=>x.onchange=()=>{preferred.hidden=kindNow()!=='reschedule'});
    m.querySelector('#mrStudentScheduleRequestForm').onsubmit=async e=>{e.preventDefault();try{
      const kind=kindNow(),raw=m.querySelector('#mrStudentPreferredAt').value,note=m.querySelector('#mrStudentRequestNote').value.trim();
      let at=null;if(kind==='reschedule'){if(!raw)return toast('Предложи дату и время');const d=new Date(raw);if(Number.isNaN(d.getTime())||d.getTime()<=Date.now())return toast('Выбери будущее время');at=d.toISOString()}
      const {error}=await sb.rpc('create_my_schedule_request',{p_lesson_id:lesson.id,p_kind:kind,p_preferred_at:at,p_note:note});if(error)throw error;
      m.remove();toast('Запрос отправлен преподавателю');document.querySelector('#mrStudentScheduleRequests')?.remove();document.querySelector('#mrStudentScheduleToday')?.remove();scheduleSync();
    }catch(err){fail(err)}};
  }

  async function enhanceStudentScheduleRequests(){
    if(!S.access||S.studentTab!=='lessons'||!S.student||document.querySelector('#mrStudentScheduleRequests'))return;
    const content=document.querySelector('#studentContent');if(!content)return;
    try{
      const [lr,requests]=await Promise.all([sb.rpc('get_my_lessons'),loadMyScheduleRequests()]);if(lr.error)throw lr.error;
      const lessons=(Array.isArray(lr.data)?lr.data:[]).filter(x=>x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=Date.now()-5*60000).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,6);
      if(S.studentTab!=='lessons'||document.querySelector('#mrStudentScheduleRequests'))return;
      const latestByLesson=new Map();for(const r of requests){if(!latestByLesson.has(r.lesson_id))latestByLesson.set(r.lesson_id,r)}
      const recent=requests.filter(r=>['approved','declined'].includes(r.status)&&r.resolved_at&&Date.now()-new Date(r.resolved_at).getTime()<14*86400000).slice(0,3);
      const box=document.createElement('section');box.id='mrStudentScheduleRequests';box.className='card mr-student-schedule-requests';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Расписание и переносы</h2><p class="small muted">Если время не подходит, отправь запрос. Сам урок изменится только после подтверждения преподавателя.</p></div></div><div class="mr-student-request-list">${lessons.length?lessons.map(l=>{const r=latestByLesson.get(l.id),meta=r?scheduleRequestStatusMeta(r.status):null;return`<article><div><small>${esc(relativeStudentDate(l.scheduled_at))}</small><b>${esc(l.topics?.title||'Урок')}</b>${r?`<span class="pill ${meta[1]}">${esc(scheduleRequestKindLabel(r.kind))} · ${esc(meta[0])}</span>`:''}${r?.status==='approved'&&r.teacher_note?`<em>${esc(r.teacher_note)}</em>`:''}${r?.status==='declined'&&r.teacher_note?`<em>${esc(r.teacher_note)}</em>`:''}</div><div class="actions">${r?.status==='pending'?`<button class="btn sm" data-student-request-existing="${r.id}" data-lesson-id="${l.id}">Запрос отправлен</button>`:`<button class="btn sm" data-student-request-new="${l.id}">Нужно изменить</button>`}</div></article>`}).join(''):'<div class="empty">Ближайших занятий пока нет.</div>'}</div>${recent.length?`<div class="mr-request-decisions"><small>Последние решения</small>${recent.map(r=>{const meta=scheduleRequestStatusMeta(r.status);return`<div><span class="pill ${meta[1]}">${esc(meta[0])}</span><b>${esc(r.topic_title||scheduleRequestKindLabel(r.kind))}</b><em>${esc(r.teacher_note||scheduleRequestKindLabel(r.kind))}</em></div>`}).join('')}</div>`:''}`;
      content.prepend(box);
      box.querySelectorAll('[data-student-request-new]').forEach(b=>b.onclick=()=>openStudentScheduleRequest(lessons.find(x=>x.id===b.dataset.studentRequestNew)));
      box.querySelectorAll('[data-student-request-existing]').forEach(b=>b.onclick=()=>openStudentScheduleRequest(lessons.find(x=>x.id===b.dataset.lessonId),requests.find(x=>x.id===b.dataset.studentRequestExisting)));
    }catch(e){console.warn('[Mathroom student schedule requests]',e)}
  }

  async function enhanceStudentScheduleToday(){
    if(!S.access||S.studentTab!=='today'||!S.student||document.querySelector('#mrStudentScheduleToday'))return;
    const root=document.querySelector('#mrStudentToday');if(!root||root.dataset.ready!=='1')return;
    try{
      const [lr,requests]=await Promise.all([sb.rpc('get_my_lessons'),loadMyScheduleRequests()]);if(lr.error)throw lr.error;
      const next=(Array.isArray(lr.data)?lr.data:[]).filter(x=>x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=Date.now()-5*60000).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0];if(!next)return;
      const latest=requests.find(x=>x.lesson_id===next.id),pending=latest?.status==='pending';
      const box=document.createElement('section');box.id='mrStudentScheduleToday';box.className='card mr-student-schedule-today';
      box.innerHTML=`<div><span class="mr-schedule-change-icon">↔</span><div><small>Расписание</small><b>${pending?'Запрос на изменение уже отправлен':'Не подходит время следующего урока?'}</b><p>${pending?`${scheduleRequestKindLabel(latest.kind)} · преподаватель ещё не подтвердил изменение.`:'Можно предложить перенос или сообщить, что не получится прийти.'}</p></div></div><button class="btn sm ${pending?'':'primary'}" id="mrTodayScheduleRequest">${pending?'Посмотреть запрос':'Изменить'}</button>`;
      const hero=root.querySelector('.mr-today-hero');hero?hero.insertAdjacentElement('afterend',box):root.prepend(box);
      box.querySelector('#mrTodayScheduleRequest').onclick=()=>openStudentScheduleRequest(next,pending?latest:null);
    }catch(e){console.warn('[Mathroom today schedule request]',e)}
  }

  async function resolveTeacherScheduleRequest(row,decision,when=null,note=''){
    const {error}=await sb.rpc('resolve_schedule_request',{p_request_id:row.id,p_decision:decision,p_scheduled_at:when,p_teacher_note:note});if(error)throw error;
    invalidateScheduleRequests();await reloadScheduleLessons();document.querySelector('#mrTeacherActionCenter')?.remove();document.querySelector('#mrTeacherScheduleRequests')?.remove();scheduleSync();
  }
  async function openTeacherScheduleRequest(row){
    if(!row)return;const lesson=scheduleRequestLesson(row),student=scheduleRequestStudent(row),isMove=row.kind==='reschedule',meta=scheduleRequestStatusMeta(row.status);
    if(row.status!=='pending')return modal(`<h2>${esc(scheduleRequestKindLabel(row.kind))}</h2><p class="muted">${esc(student?.name||'Ученик')} · ${lesson?esc(dateLong(lesson.scheduled_at)):'урок недоступен'}</p><div class="notice"><span class="pill ${meta[1]}">${esc(meta[0])}</span>${row.teacher_note?`<br><br>${nl(row.teacher_note)}`:''}</div>`);
    const m=modal(`<div class="mr-card-head"><div><h2>${esc(scheduleRequestKindLabel(row.kind))}</h2><p class="muted">${esc(student?.name||'Ученик')} · ${esc(lesson?.topics?.title||'Урок')}</p></div><span class="pill warn">ожидает решения</span></div><div class="mr-request-summary"><div><small>Сейчас в расписании</small><b>${lesson?esc(dateLong(lesson.scheduled_at)):'—'}</b></div>${isMove?`<div><small>Ученик предлагает</small><b>${esc(scheduleRequestPreferredText(row))}</b></div>`:''}${row.note?`<div><small>Комментарий ученика</small><p>${nl(row.note)}</p></div>`:''}</div><form id="mrTeacherRequestForm">${isMove?`<div class="field"><label>Подтверждённая дата и время</label><input id="mrTeacherRequestWhen" type="datetime-local" value="${esc(isoLocalInput(row.preferred_at||lesson?.scheduled_at))}" required></div>`:''}<div class="field"><label>Ответ / заметка ученику <span class="muted">необязательно</span></label><textarea id="mrTeacherRequestNote" rows="3" maxlength="1000" placeholder="Например: перенёс на четверг, время подтверждаю"></textarea></div><div class="actions"><button class="btn primary" type="submit">${isMove?'Подтвердить перенос':'Подтвердить отмену'}</button><button class="btn" type="button" id="mrTeacherRequestDecline">Не подтверждать</button></div></form>`,'wide-modal');
    m.querySelector('#mrTeacherRequestForm').onsubmit=async e=>{e.preventDefault();try{let when=null;if(isMove){const d=new Date(m.querySelector('#mrTeacherRequestWhen').value);if(Number.isNaN(d.getTime())||d.getTime()<=Date.now())return toast('Выбери будущее время');when=d.toISOString()}const note=m.querySelector('#mrTeacherRequestNote').value.trim();await resolveTeacherScheduleRequest(row,'approved',when,note);m.remove();toast(isMove?'Урок перенесён, запрос подтверждён':'Урок отменён, запрос подтверждён')}catch(err){fail(err)}};
    m.querySelector('#mrTeacherRequestDecline').onclick=async()=>{try{const note=m.querySelector('#mrTeacherRequestNote').value.trim();await resolveTeacherScheduleRequest(row,'declined',null,note);m.remove();toast('Запрос закрыт без изменения расписания')}catch(err){fail(err)}};
  }

  async function enhanceTeacherScheduleRequestsPanel(){
    if(S.access||S.view!=='schedule'||document.querySelector('#mrTeacherScheduleRequests'))return;
    const root=document.querySelector('#mrScheduleEnhanced');if(!root)return;
    try{
      const rows=(await loadTeacherScheduleRequests()).filter(x=>x.status==='pending');if(!rows.length)return;
      const box=document.createElement('section');box.id='mrTeacherScheduleRequests';box.className='card mr-teacher-schedule-requests';
      box.innerHTML=`<div class="mr-card-head"><div><h2>Запросы учеников</h2><p class="small muted">Расписание меняется только после твоего подтверждения.</p></div><span class="pill warn">${rows.length} ждут решения</span></div><div class="mr-teacher-request-list">${rows.slice(0,8).map(r=>{const l=scheduleRequestLesson(r),st=scheduleRequestStudent(r);return`<article><div><small>${esc(scheduleRequestKindLabel(r.kind))}</small><b>${esc(st?.name||'Ученик')} · ${esc(l?.topics?.title||'Урок')}</b><span>${l?esc(dateLong(l.scheduled_at)):'урок недоступен'}${r.kind==='reschedule'&&r.preferred_at?` → ${esc(dateLong(r.preferred_at))}`:''}</span>${r.note?`<em>${esc(String(r.note).slice(0,160))}</em>`:''}</div><button class="btn sm primary" data-teacher-request="${r.id}">Разобрать</button></article>`}).join('')}</div>`;
      const toolbar=root.querySelector('.mr-schedule-toolbar');toolbar?toolbar.insertAdjacentElement('afterend',box):root.prepend(box);
      box.querySelectorAll('[data-teacher-request]').forEach(b=>b.onclick=()=>openTeacherScheduleRequest(rows.find(x=>x.id===b.dataset.teacherRequest)));
    }catch(e){console.warn('[Mathroom teacher schedule requests]',e)}
  }

  // Iteration 19 — prioritized teacher action center + global quick jump.
  function openStudentProfileAnywhere(studentId){
    const direct=document.querySelector(`[data-profile="${CSS.escape(studentId)}"]`);if(direct){direct.click();return}
    const nav=document.querySelector('[data-nav="students"]');if(!nav)return toast('Раздел учеников недоступен');nav.click();
    setTimeout(()=>{const b=document.querySelector(`[data-profile="${CSS.escape(studentId)}"]`);if(b)b.click();else toast('Профиль ученика не найден')},140);
  }
  function openTopicAnywhere(topicId){
    const direct=document.querySelector(`[data-topic="${CSS.escape(topicId)}"]`);if(direct){direct.click();return}
    const nav=document.querySelector('[data-nav="topics"]');if(!nav)return toast('Раздел тем недоступен');nav.click();
    setTimeout(()=>{const b=document.querySelector(`[data-topic="${CSS.escape(topicId)}"]`);if(b)b.click();else toast('Тема не найдена')},140);
  }
  function openAssignmentAnywhere(kind,id){
    const key=`${kind}:${id}`;
    const direct=document.querySelector(`[data-assignment="${CSS.escape(key)}"]`);if(direct){direct.click();return}
    const nav=document.querySelector('[data-nav="assignments"]');if(!nav)return toast('Раздел заданий недоступен');nav.click();
    setTimeout(()=>{const b=document.querySelector(`[data-assignment="${CSS.escape(key)}"]`);if(b)b.click();else toast('Задание не найдено')},160);
  }
  function jumpTeacherView(view){document.querySelector(`[data-nav="${CSS.escape(view)}"]`)?.click()}

  function quickJumpEntries(){
    const now=Date.now(),entries=[];
    const add=(type,id,title,meta,search,action,icon)=>entries.push({type,id,title,meta,search:`${title} ${meta||''} ${search||''}`.toLowerCase(),action,icon});
    [['dashboard','Главная'],['schedule','Расписание'],['students','Ученики'],['topics','Темы'],['bank','Банк задач'],['assignments','Задания'],['history','История'],['board','Доска']].forEach(([view,title])=>add('Раздел',view,title,'Открыть раздел',view,()=>jumpTeacherView(view),'↗'));
    (S.students||[]).forEach(st=>add('Ученик',st.id,st.name,`${st.grade} класс`,'ученик профиль',()=>openStudentProfileAnywhere(st.id),'У'));
    (S.lessons||[]).filter(x=>x.status!=='cancelled'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=now-2*3600000).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,30).forEach(l=>add('Урок',l.id,`${lessonStudentName(l)} · ${lessonTopicName(l)}`,`${relativeStudentDate(l.scheduled_at)} · ${statusLabel(l.status)}`,'урок занятие расписание',()=>openLessonAnywhere(l.id),'◷'));
    (S.topics||[]).forEach(t=>add('Тема',t.id,t.title,`${t.grade} класс${t.section?` · ${t.section}`:''}`,'тема теория',()=>openTopicAnywhere(t.id),'Т'));
    const urgentHw=(S.homeworks||[]).filter(h=>h.status==='submitted'||(h.status==='assigned'&&h.revision_requested_at)||(h.status==='assigned'&&!h.revision_requested_at&&h.due_at&&new Date(h.due_at).getTime()<now));
    urgentHw.slice(0,30).forEach(h=>add('Задание',h.id,h.title,`${h.students?.name||'Ученик'} · ${h.status==='submitted'?'ждёт проверки':h.revision_requested_at?'доработка':'просрочено'}`,'домашняя дз проверка',()=>openAssignmentAnywhere('homework',h.id),'✓'));
    return entries;
  }

  async function openTeacherQuickJump(){
    if(S.access||!S.user)return;
    const existing=document.querySelector('.mr-quickjump-modal');if(existing){existing.querySelector('#mrQuickInput')?.focus();return;}
    try{
      const entries=quickJumpEntries();
      const m=modal(`<div class="mr-quickjump"><div class="mr-card-head"><div><h2>Быстрый переход</h2><p class="muted">Найди ученика, урок, тему, задание или раздел.</p></div><span class="pill">Ctrl / ⌘ + K</span></div><div class="mr-quick-search"><span>⌕</span><input id="mrQuickInput" autocomplete="off" placeholder="Например: Иван, квадратные уравнения, ДЗ…"><kbd>Esc</kbd></div><div id="mrQuickResults" class="mr-quick-results"></div><div class="small muted mr-quick-hint">↑ ↓ — выбрать · Enter — открыть</div></div>`,'wide-modal mr-quickjump-modal');
      const input=m.querySelector('#mrQuickInput'),body=m.querySelector('#mrQuickResults');let visible=[],active=0;
      const draw=()=>{
        const query=input.value.trim().toLowerCase();visible=(query?entries.filter(x=>x.search.includes(query)):entries).slice(0,14);active=Math.min(active,Math.max(0,visible.length-1));
        body.innerHTML=visible.length?visible.map((x,i)=>`<button class="mr-quick-result ${i===active?'active':''}" data-quick-index="${i}"><span>${esc(x.icon)}</span><div><small>${esc(x.type)}</small><b>${esc(x.title)}</b><em>${esc(x.meta||'')}</em></div><strong>→</strong></button>`).join(''):'<div class="empty">Ничего не найдено. Попробуй другое слово.</div>';
        body.querySelectorAll('[data-quick-index]').forEach(b=>b.onclick=()=>{const item=visible[Number(b.dataset.quickIndex)];m.remove();item?.action?.()});
      };
      input.oninput=()=>{active=0;draw()};
      input.onkeydown=e=>{
        if(e.key==='Escape'){e.preventDefault();m.remove();return}
        if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(visible.length-1,active+1);draw();return}
        if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,active-1);draw();return}
        if(e.key==='Enter'){e.preventDefault();const item=visible[active];if(item){m.remove();item.action()}}
      };
      draw();setTimeout(()=>input.focus(),20);
    }catch(e){fail(e)}
  }

  function enhanceTeacherQuickJump(){
    if(S.access||!S.user)return;
    const top=document.querySelector('.topbar');if(!top||top.querySelector('#mrQuickJumpButton'))return;
    const wrap=document.createElement('div');wrap.className='actions mr-topbar-tools';wrap.innerHTML='<button class="btn sm" id="mrQuickJumpButton"><span>⌕</span> Быстрый переход <kbd>Alt K</kbd></button>';top.appendChild(wrap);
    wrap.querySelector('#mrQuickJumpButton').onclick=openTeacherQuickJump;
  }

  function teacherActionLabel(item){
    return ({homework:'Проверить',attendance:'Отметить',wrap:'Закрыть',prep:'Подготовить'})[item.kind]||'Открыть';
  }
  function teacherActionIcon(kind){return ({homework:'✓',attendance:'●',wrap:'↺',prep:'◷'})[kind]||'•'}

  async function enhanceTeacherActionCenter(){
    if(S.access||S.view!=='dashboard'||document.querySelector('#mrTeacherActionCenter'))return;
    const content=document.querySelector('.content');if(!content)return;
    try{
      const now=Date.now(),items=[];
      const add=(kind,priority,title,meta,data={})=>items.push({kind,priority,title,meta,...data});
      (S.homeworks||[]).filter(h=>h.status==='submitted').forEach(h=>add('homework',100,`ДЗ ждёт проверки · ${h.students?.name||'Ученик'}`,h.title,{id:h.id,student_id:h.student_id}));
      (S.lessons||[]).filter(l=>pastUnmarked(l)&&now-new Date(l.scheduled_at).getTime()<=14*86400000).sort((a,b)=>new Date(b.scheduled_at)-new Date(a.scheduled_at)).slice(0,12).forEach(l=>add('attendance',90,`Не отмечена посещаемость · ${lessonStudentName(l)}`,`${lessonTopicName(l)} · ${dateLong(l.scheduled_at)}`,{lesson_id:l.id}));
      const recentCompleted=(S.lessons||[]).filter(l=>l.status==='completed'&&Date.now()-new Date(l.completed_at||l.scheduled_at).getTime()<=36*3600000);
      let reportIds=new Set();
      if(recentCompleted.length){const {data,error}=await sb.from('lesson_reports').select('lesson_id').in('lesson_id',recentCompleted.map(x=>x.id));if(!error)reportIds=new Set((data||[]).map(x=>x.lesson_id))}
      recentCompleted.filter(l=>!reportIds.has(l.id)).forEach(l=>add('wrap',88,`Нет итога урока · ${lessonStudentName(l)}`,`${lessonTopicName(l)} · ${dateLong(l.completed_at||l.scheduled_at)}`,{lesson_id:l.id}));
      const prep=await loadPrepDataset(false).catch(()=>({lessons:[],plans:[]}));
      (prep.lessons||[]).filter(l=>{const dt=new Date(l.scheduled_at).getTime()-now;const plan=(prep.plans||[]).find(p=>p.lesson_id===l.id);return dt>=-5*60000&&dt<=48*3600000&&plan?.prep_status!=='ready'}).forEach(l=>add('prep',80,`Подготовить урок · ${lessonStudentName(l)}`,`${lessonTopicName(l)} · ${relativeStudentDate(l.scheduled_at)}`,{lesson_id:l.id}));
      items.sort((a,b)=>b.priority-a.priority);
      const urgent=items.filter(x=>x.priority>=90).length,checks=items.filter(x=>x.kind==='homework').length,lessons=items.filter(x=>['attendance','wrap','prep'].includes(x.kind)).length;
      const box=document.createElement('section');box.id='mrTeacherActionCenter';box.className='card mr-action-center';
      box.innerHTML=`<div class="mr-card-head"><div><div class="actions"><span class="pill ${urgent?'warn':'good'}">${urgent?`срочно ${urgent}`:'без срочного'}</span><span class="pill">в работе ${items.length}</span></div><h2>К обработке</h2><p class="small muted">Только действия, связанные с проведением и закрытием уроков.</p></div><button class="btn sm" id="mrActionQuickJump">Быстрый переход</button></div><div class="grid cols3 mr-action-metrics"><div><small>Проверка</small><b>${checks}</b><span>сданные задания</span></div><div><small>Уроки</small><b>${lessons}</b><span>подготовка и завершение</span></div><div><small>Всего</small><b>${items.length}</b><span>${items.length?'можно разбирать сверху вниз':'всё закрыто'}</span></div></div><div class="mr-action-list">${items.length?items.slice(0,10).map((x,i)=>`<article class="mr-action-row ${x.priority>=90?'urgent':''}"><span class="mr-action-icon">${teacherActionIcon(x.kind)}</span><div><small>${i===0?'Следующее действие':x.kind==='homework'?'Задание':x.kind==='prep'?'До урока':x.kind==='wrap'?'После урока':'Журнал'}</small><b>${esc(x.title)}</b><em>${esc(x.meta||'')}</em></div><button class="btn sm ${i===0?'primary':''}" data-action-index="${i}">${teacherActionLabel(x)}</button></article>`).join(''):'<div class="empty">Очередь пуста — обязательных действий сейчас нет.</div>'}</div>`;
      const work=document.querySelector('#mrTeacherWorkday');if(work)work.insertAdjacentElement('beforebegin',box);else{const top=content.querySelector('.topbar');top?top.insertAdjacentElement('afterend',box):content.prepend(box)}
      box.querySelector('#mrActionQuickJump').onclick=openTeacherQuickJump;
      box.querySelectorAll('[data-action-index]').forEach(b=>b.onclick=()=>{const x=items[Number(b.dataset.actionIndex)];if(!x)return;if(x.kind==='homework')openAssignmentAnywhere('homework',x.id);if(x.kind==='attendance')openAttendanceModal(x.lesson_id);if(x.kind==='wrap')openLessonWrapUp(x.lesson_id);if(x.kind==='prep')openLessonPreparation(x.lesson_id)});
    }catch(e){console.warn('[Mathroom action center]',e)}
  }

  async function refreshNonLessonEnhancements() {
    if (!S.access && S.view === 'profile') { await enhanceTeacherProfile(); await enhanceStudentAttendanceProfile(); await enhanceSmartPreparation(); await enhanceAttentionOverview(); await enhanceRoadmapOverview(); await enhanceMasteryOverview(); await enhanceLearningIntelligence(); await enhanceTargetTrajectoryOverview(); await enhanceActivityOverview(); }
    if (!S.access) enhanceTeacherQuickJump();
    if (!S.access && S.view === 'dashboard') { await enhanceTeacherActionCenter(); await enhanceTeacherOperationsDashboard(); await enhancePostLessonClosure(); await enhancePreparationCenter(); await enhanceDashboardHomeworkWatch(); }
    if (!S.access && S.view === 'schedule') { await enhanceScheduleWorkspace(); }
    if (S.access && S.studentTab === 'today') { await enhanceStudentToday(); }
    if (S.access && S.studentTab === 'progress') { await enhanceStudentGoals(); await enhanceStudentReview(); await enhanceStudentMastery(); await enhanceStudentProgressSnapshots(); await enhanceStudentActivity(); }
  }

  async function syncContext() {
    await refreshNonLessonEnhancements().catch(e => console.warn('[Mathroom cumulative]', e));
    const ctx = ctxNow();
    const key = ctx ? `${ctx.role}:${ctx.lessonId}` : '';
    if (key !== activeKey) {
      if (call) call.destroy(); call = null; window.MathroomLiveCall=null; activeKey = key;
      clearTimeout(noteSaveTimer); noteSaveTimer = null; noteLessonId = '';
      historyBaseline.clear();
      clearInterval(refreshTimer); refreshTimer = null;
      if (ctx) {
        call = new VideoSession(ctx); window.MathroomLiveCall=call;
        refreshTimer = setInterval(() => {
          const c = ctxNow(); if (!c || `${c.role}:${c.lessonId}` !== activeKey) return;
          if (c.role === 'teacher') refreshTeacherAddon(c); else refreshStudentAddon();
        }, 2500);
      }
    }
    if (!ctx) return;
    if (ctx.role === 'teacher') { await ensureLessonStartedEvent(ctx); await refreshTeacherAddon(ctx); } else refreshStudentAddon();
  }


  let lastHistoryLessonId = '';
  async function enhanceCompletedHistoryModal(lessonId) {
    if (!lessonId) return;
    await wait(80);
    const modals = [...document.querySelectorAll('.modal-backdrop .modal')];
    const target = modals.at(-1); if (!target || target.querySelector('#mrCompletedTimeline')) return;
    try {
      const { data, error } = await sb.from('lesson_events').select('*').eq('lesson_id', lessonId).order('created_at', { ascending: false }).limit(120);
      if (error) return;
      const section = document.createElement('section'); section.id = 'mrCompletedTimeline'; section.className = 'mr-completed-timeline';
      section.innerHTML = `<div class="hr"></div><div class="mr-history-head"><div><h3>Хронология занятия</h3><p class="small muted">Последние события этого урока.</p></div><div class="actions"><button class="btn sm" id="mrLessonParentOpen">Отчёт родителю</button><button class="btn sm" id="mrCompletedHistoryOpen">Открыть полностью</button></div></div><div class="mr-completed-mini">${(data || []).length ? (data || []).slice(0,8).map(e => { const [icon,label] = eventMeta(e.kind,e.details); const t = new Date(e.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); return `<div><span>${icon}</span><b>${t}</b><em>${esc(e.title || label)}</em></div>`; }).join('') : '<div class="small muted">Хронология для этого урока ещё не записывалась.</div>'}</div>`;
      const close = target.querySelector('.modal-default-close'); target.insertBefore(section, close || null);
      section.querySelector('#mrCompletedHistoryOpen').onclick = () => openLessonHistory({ role:'teacher', lessonId, studentId: null });
      section.querySelector('#mrLessonParentOpen').onclick = () => openLessonParentReport(lessonId);
    } catch (e) { console.warn('[Mathroom completed history]', e); }
  }

  document.addEventListener('click', e => {
    const historyBtn = e.target.closest?.('[data-history]');
    if (historyBtn) {
      lastHistoryLessonId = historyBtn.dataset.history || '';
      setTimeout(() => enhanceCompletedHistoryModal(lastHistoryLessonId), 120);
    }
    if (e.target.closest?.('#finishConfirm')) {
      const ctx = ctxNow();
      if (ctx?.role === 'teacher') {
        appendLessonEvents(ctx, [{ kind: 'lesson_completed', title: ctx.lesson?.topics?.title || 'Урок', details: { completed_at: new Date().toISOString() } }]).catch(() => {});
        const currentAttendance=ctx.lesson?.attendance_status || 'unmarked';
        if(currentAttendance==='unmarked'){
          const started=ctx.lesson?.started_at?new Date(ctx.lesson.started_at).getTime():null;
          const actual=started?Math.max(1,Math.round((Date.now()-started)/60000)):Number(ctx.lesson?.duration_minutes||60);
          setAttendance(ctx.lessonId,'present',ctx.lesson?.attendance_note||'',actual).catch(e=>console.warn('[Mathroom attendance]',e));
        }
        const sid=ctx.studentId; setTimeout(()=>saveProgressSnapshot(sid,'lesson',true).catch(e=>console.warn('[Mathroom snapshot]',e)),1800);
      }
    }
  }, true);

  let scheduled = false;
  function scheduleSync() {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(async () => { scheduled = false; await syncContext(); });
  }

  window.addEventListener('keydown', e => {
    if (!S.access && e.altKey && !e.ctrlKey && !e.metaKey && String(e.code||'')==='KeyK') {
      e.preventDefault(); e.stopImmediatePropagation?.(); openTeacherQuickJump(); return;
    }
  });

  window.addEventListener('keydown', e => {
    if (!call || !e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = String(e.key || '').toLowerCase();
    if (key === 'm') { e.preventDefault(); call.toggleMic(); }
    if (key === 'v') { e.preventDefault(); call.toggleCamera(); }
    if (key === 's') { e.preventDefault(); call.shareScreen(); }
    const ctx = ctxNow();
    if (ctx?.role === 'teacher' && ['arrowleft','arrowright','1','2','3','0'].includes(key)) {
      e.preventDefault();
      (async () => {
        const queue = await getQueue(ctx.lessonId), live = await getLiveState(ctx.lessonId);
        const ordered = [...queue].sort((a,b)=>(a.position||0)-(b.position||0));
        const i = ordered.findIndex(x=>x.id===live?.current_queue_item_id);
        if (key === 'arrowleft') return setCurrentFromAddon(ctx, i > 0 ? ordered[i-1] : ordered.at(-1));
        if (key === 'arrowright') return setCurrentFromAddon(ctx, i >= 0 ? ordered[(i+1)%Math.max(ordered.length,1)] : ordered[0]);
        const current = ordered.find(x=>x.id===live?.current_queue_item_id); if (!current) return toast('Выбери текущую задачу');
        const map = {'1':'solved','2':'hard','3':'later','0':'pending'};
        const { error } = await sb.from('lesson_queue_items').update({status:map[key]}).eq('id',current.id); if(error) throw error; window.dispatchEvent(new Event('mathroom:refresh-lesson'));
      })().catch(fail);
    }
  });

  let studentLessonWatchBusy=false;
  async function checkStudentLessonNow(){
    if(!S.access||!S.student||studentLessonWatchBusy)return;
    studentLessonWatchBusy=true;
    try{
      const {data,error}=await sb.rpc('get_my_lessons');if(error)return;
      const active=(Array.isArray(data)?data:[]).find(x=>x.status==='in_progress')||null;
      const activeId=active?.id||null,currentId=S.studentLive?.lesson_id||null;
      if(activeId!==currentId&&typeof window.renderStudent==='function'){
        await window.renderStudent();
        // renderStudent fetches lesson_live_state; if it was created a fraction later,
        // retry on the next tick instead of requiring a page refresh.
      }
    }catch(e){console.warn('[Mathroom student lesson watch]',e)}finally{studentLessonWatchBusy=false}
  }
  const studentLessonWatchTimer=setInterval(()=>checkStudentLessonNow().catch(()=>{}),900);
  window.addEventListener('focus',()=>checkStudentLessonNow().catch(()=>{}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkStudentLessonNow().catch(()=>{})});


  observer = new MutationObserver(scheduleSync);
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => { call?.destroy(); clearInterval(refreshTimer); clearInterval(studentLessonWatchTimer); observer?.disconnect(); });
  scheduleSync();
})();
