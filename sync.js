// ══════════════════
// CLOUD SYNC (Supabase) — 기기 간 데이터 연동
// ══════════════════
// 도안자이 CRM과 같은 프로젝트(supabase-bistre-nest)를 함께 쓴다. publishable key는 공개용 키.
const SB_URL = 'https://mplawfwsxaqefowsscug.supabase.co';
const SB_KEY = 'sb_publishable_zHwZbl_d03xZNHx8renxJw_nj6VBDpa';
const SB_ROW = 'daesinfc';

// 기기 간 공유할 키 (dasinfc_view 같은 화면 설정은 기기별로 둔다)
const SYNC_KEYS = [
  'dasinfc_roster','dasinfc_seed','dasinfc_field','dasinfc_match','dasinfc_events',
  'dasinfc_attendees','dasinfc_game_log','dasinfc_current_game_id','dasinfc_current_game_info',
  'dasinfc_opponents','dasinfc_ball',
];
const CLOUD_ON = !!(SB_URL && SB_KEY);
// 예전 anon 키(JWT)만 Authorization 헤더에 싣는다. sb_publishable_ 키는 apikey 헤더로 충분.
const SB_HEADERS = {apikey:SB_KEY, 'Content-Type':'application/json',
  ...(SB_KEY.startsWith('eyJ') ? {Authorization:'Bearer '+SB_KEY} : {})};

let syncPulled = false;   // 첫 불러오기가 끝나기 전에는 올리지 않는다
let syncTimer  = null;

function lsSet(k,v){
  localStorage.setItem(k,v);
  if(SYNC_KEYS.includes(k)) markDirty();
}
function lsDel(k){
  localStorage.removeItem(k);
  if(SYNC_KEYS.includes(k)) markDirty();
}
function markDirty(){
  if(!CLOUD_ON) return;
  localStorage.setItem('dasinfc_dirty','1');
  if(!syncPulled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(cloudPush, 800);
  setSyncStatus('pending');
}

function syncSnapshot(){
  const d = {};
  SYNC_KEYS.forEach(k=>{ const v = localStorage.getItem(k); if(v!==null) d[k]=v; });
  return d;
}

function setSyncStatus(st){
  const el = document.getElementById('h-sync');
  if(!el) return;
  const map = {ok:['☁️ 동기화됨','ok'], pending:['☁️ 저장 중…','pending'], err:['⚠️ 동기화 실패','err'], off:['',''] };
  const [txt,cls] = map[st] || map.off;
  el.textContent = txt;
  el.className = 'h-sync ' + cls;
}

async function cloudPush(keepalive){
  if(!CLOUD_ON) return;
  clearTimeout(syncTimer);
  const ts = Date.now();
  try{
    const r = await fetch(SB_URL+'/rest/v1/app_state', {
      method:'POST', keepalive:!!keepalive,
      headers:{...SB_HEADERS, Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify({id:SB_ROW, data:syncSnapshot(), updated_ms:ts}),
    });
    if(!r.ok) throw new Error(r.status+' '+await r.text());
    localStorage.setItem('dasinfc_sync_ts', String(ts));
    localStorage.removeItem('dasinfc_dirty');
    setSyncStatus('ok');
  }catch(e){
    console.warn('cloudPush 실패', e);
    setSyncStatus('err');
  }
}

async function cloudPull(){
  if(!CLOUD_ON){ setSyncStatus('off'); return; }
  try{
    const r = await fetch(SB_URL+'/rest/v1/app_state?id=eq.'+SB_ROW+'&select=data,updated_ms', {headers:SB_HEADERS});
    if(!r.ok) throw new Error(r.status+' '+await r.text());
    const rows = await r.json();
    syncPulled = true;
    const localTs = Number(localStorage.getItem('dasinfc_sync_ts') || 0);
    const dirty   = !!localStorage.getItem('dasinfc_dirty');

    // 클라우드가 비어 있으면 이 기기 데이터를 올린다
    if(!rows.length || !rows[0].updated_ms){ await cloudPush(); return; }

    const {data, updated_ms} = rows[0];
    if(updated_ms <= localTs){
      if(dirty) await cloudPush(); else setSyncStatus('ok');
      return;
    }
    // 이 기기에도 아직 안 올린 변경이 있거나, 처음 연결하는 기기에 경기 기록이 따로 있으면 어느 쪽을 쓸지 묻는다
    const countGames = v=>{ try{ return JSON.parse(v||'[]').length; }catch(e){ return 0; } };
    const localGames  = countGames(localStorage.getItem('dasinfc_game_log'));
    const remoteGames = countGames(data.dasinfc_game_log);
    const firstWithData = localTs === 0 && localGames > 0 &&
      localStorage.getItem('dasinfc_game_log') !== data.dasinfc_game_log;
    if(((dirty && localTs > 0) || firstWithData) &&
       !confirm('다른 기기에서 저장한 데이터가 있습니다.\n'+
                '· 다른 기기 경기 기록: '+remoteGames+'개\n· 이 기기 경기 기록: '+localGames+'개\n\n'+
                '확인: 다른 기기 데이터 불러오기\n취소: 이 기기 데이터로 덮어쓰기')){
      await cloudPush();
      return;
    }
    SYNC_KEYS.forEach(k=>{
      if(k in data) localStorage.setItem(k, data[k]); else localStorage.removeItem(k);
    });
    localStorage.setItem('dasinfc_sync_ts', String(updated_ms));
    localStorage.removeItem('dasinfc_dirty');
    location.reload();
  }catch(e){
    console.warn('cloudPull 실패', e);
    syncPulled = true;
    setSyncStatus('err');
  }
}

if(CLOUD_ON){
  window.addEventListener('DOMContentLoaded', cloudPull);
  // 다른 기기에서 작업하다 돌아오면 최신 데이터를 다시 확인
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='visible') cloudPull();
    else if(localStorage.getItem('dasinfc_dirty') && syncPulled) cloudPush(true);
  });
}
