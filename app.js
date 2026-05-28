// ─────────────────────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────────────────────
const STATE = {
  user: null,           // Firebase user object
  profile: null,        // Firestore user doc
  role: null,           // 'driver' | 'admin'
  driverStep: 0,
  gpsWatchId: null,
  currentDelivery: null,
  deliveries: [],
  driverHistory: [],
  drivers: [],
  adminCurTab: 'drivers',
  selectedDeliveryId: null,
  unsubDeliveries: null,
  unsubDrivers: null,
};

const profileCache = new Map();
let lastLocationSave = 0;
let lastAuthUid = null;
let authHandling = false;
let sessionRestored = false;

function applyLayout(){
  const desktop = window.matchMedia('(min-width: 900px)').matches;
  document.body.classList.toggle('is-desktop', desktop);
  document.body.classList.toggle('is-mobile', !desktop);
}
// Adiar layout check para não bloquear carregamento inicial
requestAnimationFrame(applyLayout);
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(applyLayout, 100);
});

window.addEventListener('error', (e)=>{
  console.error(e.error || e.message);
  if(typeof showToast === 'function') showToast('⚠️ Erro no app. Recarregue a página.');
});
window.addEventListener('unhandledrejection', (e)=>{
  console.error(e.reason);
});

function driverSideNav(btn, tab){
  console.log('=== driverSideNav iniciado ===');
  console.log('Tab:', tab);
  console.log('Botão:', btn);
  document.querySelectorAll('#driver-sidebar .side-link[data-dtab]').forEach(b=>{
    b.classList.toggle('on', b === btn);
  });
  const navBtns = document.querySelectorAll('#screen-driver .nav-btn');
  const idx = {home:0, deliveries:1, status:2, history:3}[tab];
  console.log('Índice da aba:', idx);
  navBtns.forEach(b=>b.classList.remove('on'));
  if(navBtns[idx]) navBtns[idx].classList.add('on');
  console.log('Chamando driverNavTab...');
  driverNavTab(null, tab);
  console.log('=== driverSideNav concluído ===');
}

function driverNavTab(btn, tab){
  console.log('=== driverNavTab iniciado ===');
  console.log('Tab:', tab);
  
  // Atualiza botões de navegação
  const navBtns = document.querySelectorAll('#screen-driver .nav-btn');
  navBtns.forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');

  // Oculta todas as abas
  const allTabs = document.querySelectorAll('.driver-tab-content');
  console.log('Total de abas encontradas:', allTabs.length);
  allTabs.forEach(el => {
    console.log('Ocultando aba:', el.id);
    el.style.display = 'none';
  });

  // Mostra a aba selecionada
  const tabContent = document.getElementById('driver-tab-' + tab);
  console.log('Tab content encontrado:', !!tabContent);
  console.log('ID procurado:', 'driver-tab-' + tab);
  if(tabContent){
    tabContent.style.display = 'block';
    console.log('Tab content exibido');
  } else {
    console.error('Tab content não encontrado:', 'driver-tab-' + tab);
    // Se não encontrar, mostra a aba home
    const homeTab = document.getElementById('driver-tab-home');
    if(homeTab){
      homeTab.style.display = 'block';
      console.log('Mostrando aba home como fallback');
    }
  }
  console.log('=== driverNavTab concluído ===');
}

function adminSideHighlight(btn){
  document.querySelectorAll('#admin-sidebar .side-link').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
}

function waitFirebase(cb){
  if(window.$firebaseReady) cb();
  else document.addEventListener('firebase-ready', cb, {once:true});
}

function hideLoading(){
  const lo = document.getElementById('loading-overlay');
  if(!lo) return;
  lo.classList.add('hide');
  setTimeout(()=>{ lo.style.display='none'; }, 120);
}

function saveRolePreference(role){
  try{ sessionStorage.setItem('hmb-role', role); }catch{}
}

function getRolePreference(){
  try{ return sessionStorage.getItem('hmb-role'); }catch{ return null; }
}

waitFirebase(()=>{
  // Timeout extra para garantir que loading seja escondido
  setTimeout(() => {
    const lo = document.getElementById('loading-overlay');
    if(lo && lo.style.display !== 'none'){
      console.warn('Forçando hide loading - timeout auth');
      lo.classList.add('hide');
      setTimeout(() => { lo.style.display = 'none'; }, 120);
    }
  }, 5000);

  // Se Firebase não está disponível, esconde loading e vai para home
  if(!window.$firebaseReady || !window.$auth || !window.$db){
    console.warn('Firebase não disponível, operando em modo limitado');
    hideLoading();
    goTo('screen-home');
    const b = document.getElementById('config-banner');
    if(b) {
      b.style.display='block';
      b.querySelector('h4').textContent = '⚠️ Firebase não configurado';
      b.querySelector('p').textContent = 'Configure firebase-config.js para usar todas as funcionalidades.';
    }
    return;
  }

  const {onAuthStateChanged} = window.$firebase;

  onAuthStateChanged(window.$auth, async user=>{
    if(authHandling) return;
    authHandling = true;

    try{
      const uid = user?.uid || null;
      if(uid === lastAuthUid && sessionRestored) {
        authHandling = false;
        hideLoading();
        return;
      }
      lastAuthUid = uid;

      if(user){
        STATE.user = user;
        try{
          let profile = loadProfileFromSession(uid);
          if(!profile){
            profile = await loadProfile(uid, {preferCache:true, timeout:3000});
          }
          if(!profile){
            const fallbackRole = STATE.role || getRolePreference() || 'driver';
            profile = await ensureUserProfile(user, fallbackRole);
          }
          if(profile){
            STATE.profile = profile;
            STATE.role = profile.role;
            saveProfileToSession(uid, profile);
            sessionRestored = true;
            hideLoading();
            resumeSession();
            authHandling = false;
            return;
          }
        }catch(err){
          console.warn('auth boot:', err);
          if(err.message === 'permission-denied'){
            showToast('⚠️ Sem permissão para acessar dados');
          }
        }
      } else {
        sessionRestored = false;
        profileCache.clear();
        STATE.user = null;
        STATE.profile = null;
      }
      hideLoading();
      goTo('screen-home');
    }catch(err){
      console.error('Auth state error:', err);
      hideLoading();
      goTo('screen-home');
    }finally{
      authHandling = false;
      hideLoading();
    }
  });

  if(window.$auth.app.options.apiKey === 'SUA_API_KEY'){
    const b = document.getElementById('config-banner');
    if(b) b.style.display='block';
  }
  checkPasswordResetLink();
});

function saveProfileToSession(uid, data){
  try{ sessionStorage.setItem('hmb-profile-'+uid, JSON.stringify({name:data.name,email:data.email,role:data.role,vehicle:data.vehicle||'',adminCode:data.adminCode||''})); }catch{}
}

function loadProfileFromSession(uid){
  try{
    const raw = sessionStorage.getItem('hmb-profile-'+uid);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(data?.role){ profileCache.set(uid, data); return data; }
  }catch{}
  return null;
}

async function loadProfile(uid, opts={}){
  const {preferCache=false, forceServer=false} = opts;
  if(!forceServer && profileCache.has(uid)) return profileCache.get(uid);

  const {doc, getDoc, getDocFromCache, getDocFromServer} = window.$firebase;
  const ref = doc(window.$db,'users',uid);

  if(preferCache && !forceServer && getDocFromCache){
    try{
      const cached = await getDocFromCache(ref);
      if(cached.exists()){
        const data = cached.data();
        profileCache.set(uid, data);
        saveProfileToSession(uid, data);
        return data;
      }
    }catch{}
  }

  try{
    const snap = forceServer && getDocFromServer
      ? await getDocFromServer(ref)
      : await getDoc(ref);
    if(snap.exists()){
      const data = snap.data();
      profileCache.set(uid, data);
      saveProfileToSession(uid, data);
      return data;
    }
    return null;
  }catch(err){
    const code = err?.code || '';
    if(code === 'permission-denied') throw new Error('permission-denied');
    console.warn('loadProfile:', code || err);
    return loadProfileFromSession(uid);
  }
}

async function ensureUserProfile(user, role, extra={}){
  const {doc, setDoc, getDoc, getDocFromServer, serverTimestamp} = window.$firebase;
  const ref = doc(window.$db,'users',user.uid);

  try{
    const snap = getDocFromServer ? await getDocFromServer(ref) : await getDoc(ref);
    if(snap.exists()){
      const data = snap.data();
      profileCache.set(user.uid, data);
      saveProfileToSession(user.uid, data);
      return data;
    }
  }catch(err){
    const code = err?.code || err?.message || '';
    if(code === 'permission-denied'){
      throw new Error('permission-denied');
    }
  }

  const data = {
    uid: user.uid,
    name: extra.name || user.displayName || user.email?.split('@')[0] || 'Usuário',
    email: (extra.email || user.email || '').toLowerCase(),
    role,
    vehicle: extra.vehicle || '',
    deliveriesToday: 0,
    totalDeliveries: 0,
    online: true,
    adminCode: extra.code || '',
    createdAt: serverTimestamp()
  };

  if(role === 'admin' && !data.adminCode){
    data.adminCode = generateAdminCode();
  }

  try{
    await setDoc(ref, data);
  }catch(err){
    const snap = await getDoc(ref);
    if(snap.exists()){
      const existing = snap.data();
      profileCache.set(user.uid, existing);
      saveProfileToSession(user.uid, existing);
      return existing;
    }
    throw err;
  }

  profileCache.set(user.uid, data);
  saveProfileToSession(user.uid, data);
  return data;
}

function generateAdminCode(){
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for(let i = 0; i < 6; i++){
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function resumeSession(){
  if(STATE.profile?.role === 'driver') enterDriver();
  else if(STATE.profile?.role === 'admin') enterAdmin();
  else if(STATE.role==='driver') enterDriver();
  else enterAdmin();
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
function goTo(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function selectRole(role){
  STATE.role = role;
  saveRolePreference(role);
  const chip = document.getElementById('login-role-chip');
  const title = document.getElementById('login-title');
  const sub = document.getElementById('login-sub');
  const vg = document.getElementById('r-vehicle-group');
  const cg = document.getElementById('r-code-group');
  if(role==='driver'){
    chip.textContent='🧑‍✈️ Motorista';
    title.textContent='Bem-vindo, Motorista!';
    sub.textContent='Entre ou crie sua conta de motorista';
    if(vg) vg.style.display='block';
    if(cg) cg.style.display='block';
  } else {
    chip.textContent='👨‍💼 Administrador';
    title.textContent='Painel do Administrador';
    sub.textContent='Acesso restrito — conta admin';
    if(vg) vg.style.display='none';
    if(cg) cg.style.display='none';
  }
  loginTab('login');
  goTo('screen-login');
}

function loginTab(tab){
  document.getElementById('tab-login').classList.toggle('on', tab==='login');
  document.getElementById('tab-register').classList.toggle('on', tab==='register');
  document.getElementById('form-login').style.display = tab==='login' ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab==='register' ? 'block' : 'none';
  document.getElementById('form-forgot').style.display = 'none';
  document.querySelector('.login-tabs').style.display = 'flex';
  hideLoginError();
}

const FORGOT = { oobCode: null, email: '' };

function getResetContinueUrl(){
  const authDomain = window.$auth?.app?.options?.authDomain || 'hmb-transportes.firebaseapp.com';
  const projectId = window.$auth?.app?.options?.projectId || 'hmb-transportes';
  const official = [
    `https://${authDomain}/`,
    `https://${projectId}.web.app/`
  ];
  const origin = window.location.origin;
  const localOk = origin === 'http://localhost' || origin === 'http://127.0.0.1'
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if(localOk){
    const u = new URL(window.location.href);
    u.search = '';
    u.hash = '';
    return u.href;
  }
  if(origin && (origin.includes(authDomain) || origin.includes(projectId + '.web.app'))){
    const u = new URL(window.location.href);
    u.search = '';
    u.hash = '';
    return u.href;
  }
  return official[0];
}

function setForgotStep(step){
  [1,2,3].forEach(n=>{
    const p = document.getElementById('forgot-panel-'+n);
    const d = document.getElementById('fd-'+n);
    if(p) p.style.display = n===step ? 'block' : 'none';
    if(d){ d.classList.toggle('on', n<=step); }
  });
}

function openForgotPassword(oobCode){
  loginTab('login');
  document.getElementById('form-login').style.display = 'none';
  document.getElementById('form-forgot').style.display = 'block';
  document.querySelector('.login-tabs').style.display = 'none';
  hideLoginError();
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  if(email) document.getElementById('fp-email').value = email;
  if(oobCode){
    FORGOT.oobCode = oobCode;
    document.getElementById('fp-code').value = oobCode;
    setForgotStep(2);
    forgotVerifyCode();
  } else {
    FORGOT.oobCode = null;
    setForgotStep(1);
  }
}

function closeForgotPassword(){
  document.getElementById('form-forgot').style.display = 'none';
  document.getElementById('form-login').style.display = 'block';
  document.querySelector('.login-tabs').style.display = 'flex';
  FORGOT.oobCode = null;
  hideLoginError();
}

async function forgotSendCode(isResend){
  const email = document.getElementById('fp-email').value.trim().toLowerCase();
  if(!email){ showLoginError('Informe seu e-mail.'); return; }
  hideLoginError();
  const btn = document.getElementById('btn-fp-send');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try{
    const {sendPasswordResetEmail} = window.$firebase;
    const actionSettings = {
      url: getResetContinueUrl(),
      handleCodeInApp: true
    };
    try{
      await sendPasswordResetEmail(window.$auth, email, actionSettings);
    }catch(inner){
      if(inner?.code === 'auth/unauthorized-continue-uri'){
        await sendPasswordResetEmail(window.$auth, email, {
          url: `https://${window.$auth.app.options.authDomain}/`,
          handleCodeInApp: false
        });
      } else throw inner;
    }
    FORGOT.email = email;
    document.getElementById('l-email').value = email;
    setForgotStep(2);
    showToast(isResend ? '📧 Código reenviado no e-mail!' : '📧 Código enviado! Confira sua caixa de entrada.');
  }catch(e){
    showLoginError(firebaseErrorMsg(e.code, 'reset'));
  }finally{
    btn.disabled = false;
    btn.textContent = 'Enviar código';
  }
}

async function forgotVerifyCode(){
  const code = (FORGOT.oobCode || document.getElementById('fp-code').value || '').trim();
  if(!code){ showLoginError('Cole o código de verificação do e-mail.'); return; }
  hideLoginError();
  const btn = document.getElementById('btn-fp-verify');
  btn.disabled = true;
  btn.textContent = 'Verificando...';
  try{
    const {verifyPasswordResetCode} = window.$firebase;
    const email = await verifyPasswordResetCode(window.$auth, code);
    FORGOT.oobCode = code;
    FORGOT.email = email;
    document.getElementById('fp-email-ok').textContent = email;
    setForgotStep(3);
    showToast('✅ Código válido!');
  }catch(e){
    showLoginError('Código inválido ou expirado. Toque no link do e-mail ou reenvie um novo código.');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Verificar código';
  }
}

async function forgotSavePassword(){
  const pass = document.getElementById('fp-pass').value;
  const pass2 = document.getElementById('fp-pass2').value;
  if(!FORGOT.oobCode){ showLoginError('Verifique o código antes de salvar a senha.'); return; }
  if(pass.length < 6){ showLoginError('Senha deve ter pelo menos 6 caracteres.'); return; }
  if(pass !== pass2){ showLoginError('As senhas não coincidem.'); return; }
  hideLoginError();
  const btn = document.getElementById('btn-fp-save');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try{
    const {confirmPasswordReset} = window.$firebase;
    await confirmPasswordReset(window.$auth, FORGOT.oobCode, pass);
    closeForgotPassword();
    document.getElementById('l-email').value = FORGOT.email || '';
    document.getElementById('fp-pass').value = '';
    document.getElementById('fp-pass2').value = '';
    document.getElementById('fp-code').value = '';
    showToast('✅ Senha alterada! Entre com a nova senha.');
  }catch(e){
    showLoginError(firebaseErrorMsg(e.code, 'reset'));
  }finally{
    btn.disabled = false;
    btn.textContent = 'Salvar nova senha';
  }
}

function checkPasswordResetLink(){
  const params = new URLSearchParams(window.location.search);
  if(params.get('mode') === 'resetPassword' && params.get('oobCode')){
    goTo('screen-login');
    openForgotPassword(params.get('oobCode'));
    history.replaceState({}, document.title, location.pathname);
  }
}

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
function togglePass(id, btn){
  const el = document.getElementById(id);
  if(el.type==='password'){ el.type='text'; btn.textContent='🙈'; }
  else { el.type='password'; btn.textContent='👁'; }
}

function showLoginError(msg){
  const el = document.getElementById('login-error');
  document.getElementById('login-error-msg').textContent = msg;
  el.classList.add('show');
}
function hideLoginError(){
  document.getElementById('login-error').classList.remove('show');
}

function setBtnLoading(id, loading){
  const btn = document.getElementById(id);
  if(!btn) return;
  btn.disabled = loading;
  if(loading){
    const spinner = document.createElement('div');
    spinner.className = 'spin-small';
    btn.innerHTML = '';
    btn.appendChild(spinner);
    btn.appendChild(document.createTextNode(' Aguarde...'));
  } else {
    btn.textContent = id==='btn-login' ? 'Entrar' : 'Criar Conta';
  }
}

async function doLogin(){
  hideLoginError();
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  if(!email || !pass){ showLoginError('Preencha e-mail e senha.'); return; }
  if(!STATE.role){ showLoginError('Volte e escolha Motorista ou Administrador.'); return; }

  setBtnLoading('btn-login', true);
  authHandling = true;
  try{
    const {signInWithEmailAndPassword} = window.$firebase;
    const cred = await signInWithEmailAndPassword(window.$auth, email, pass);
    // Usa cache primeiro para login mais rápido
    let profile = await loadProfile(cred.user.uid, {preferCache:true});

    if(!profile){
      try{
        profile = await ensureUserProfile(cred.user, STATE.role);
        showToast('✅ Perfil criado. Bem-vindo!');
      }catch(pe){
        await window.$firebase.signOut(window.$auth);
        showLoginError(pe?.message === 'permission-denied'
          ? 'Sem permissão no Firestore. Publique as regras: firebase deploy --only firestore:rules'
          : 'Não foi possível criar seu perfil. Tente de novo.');
        return;
      }
    }

    if(profile.role !== STATE.role){
      const tipo = profile.role === 'driver' ? 'Motorista' : 'Administrador';
      showLoginError(`Esta conta é de ${tipo}. Volte e selecione o perfil correto.`);
      await window.$firebase.signOut(window.$auth);
      profileCache.delete(cred.user.uid);
      return;
    }

    STATE.user = cred.user;
    STATE.profile = profile;
    sessionRestored = true;
    lastAuthUid = cred.user.uid;
    saveRolePreference(profile.role);
    saveProfileToSession(cred.user.uid, profile);
    hideLoading();
    resumeSession();
  } catch(e){
    showLoginError(firebaseErrorMsg(e.code, 'login'));
  } finally {
    authHandling = false;
    setBtnLoading('btn-login', false);
  }
}

async function doRegister(){
  hideLoginError();
  const name    = document.getElementById('r-name').value.trim();
  const email   = document.getElementById('r-email').value.trim().toLowerCase();
  const pass    = document.getElementById('r-pass').value;
  const vehicle = document.getElementById('r-vehicle')?.value.trim() || '';
  const code    = document.getElementById('r-code')?.value.trim().toUpperCase() || '';
  if(!name || !email || !pass){ showLoginError('Preencha todos os campos obrigatórios.'); return; }
  if(pass.length < 6){ showLoginError('Senha deve ter pelo menos 6 caracteres.'); return; }
  if(!STATE.role){ showLoginError('Volte e escolha Motorista ou Administrador.'); return; }

  setBtnLoading('btn-register', true);
  authHandling = true;
  try{
    const {createUserWithEmailAndPassword, updateProfile, signInWithEmailAndPassword} = window.$firebase;
    const cred = await createUserWithEmailAndPassword(window.$auth, email, pass);
    await updateProfile(cred.user, {displayName: name});
    const profile = await ensureUserProfile(cred.user, STATE.role, { name, email, vehicle, code });
    STATE.user = cred.user;
    STATE.profile = profile;
    sessionRestored = true;
    lastAuthUid = cred.user.uid;
    saveRolePreference(profile.role);
    saveProfileToSession(cred.user.uid, profile);
    showToast('✅ Conta criada com sucesso!');
    hideLoading();
    resumeSession();
  } catch(e){
    if(e.code === 'auth/email-already-in-use'){
      authHandling = true;
      try{
        const {signInWithEmailAndPassword} = window.$firebase;
        const cred = await signInWithEmailAndPassword(window.$auth, email, pass);
        let profile = await loadProfile(cred.user.uid, {preferCache:true});
        if(!profile){
          profile = await ensureUserProfile(cred.user, STATE.role, { name, email, vehicle, code });
          STATE.user = cred.user;
          STATE.profile = profile;
          sessionRestored = true;
          lastAuthUid = cred.user.uid;
          saveRolePreference(profile.role);
          saveProfileToSession(cred.user.uid, profile);
          showToast('✅ Conta recuperada. Bem-vindo!');
          hideLoading();
          resumeSession();
          return;
        }
        if(profile.role !== STATE.role){
          const tipo = profile.role === 'driver' ? 'Motorista' : 'Administrador';
          showLoginError(`E-mail já cadastrado como ${tipo}. Volte e escolha o perfil certo, depois use Entrar.`);
          await window.$firebase.signOut(window.$auth);
          loginTab('login');
          document.getElementById('l-email').value = email;
          return;
        }
        showLoginError('Este e-mail já existe. Use a aba Entrar com a mesma senha.');
        loginTab('login');
        document.getElementById('l-email').value = email;
        return;
      }catch(signErr){
        showLoginError('E-mail já cadastrado, mas a senha não confere. Use Entrar com a senha correta.');
        loginTab('login');
        document.getElementById('l-email').value = email;
        return;
      }finally{
        authHandling = false;
      }
    }
    showLoginError(firebaseErrorMsg(e.code, 'register'));
  } finally {
    authHandling = false;
    setBtnLoading('btn-register', false);
  }
}

async function doLogout(){
  closeModal('modal-profile');
  if(STATE.unsubDeliveries) STATE.unsubDeliveries();
  if(STATE.unsubDrivers) STATE.unsubDrivers();
  if(STATE.gpsWatchId) navigator.geolocation.clearWatch(STATE.gpsWatchId);
  const uid = STATE.user?.uid;
  await window.$firebase.signOut(window.$auth);
  if(uid){
    profileCache.delete(uid);
    try{ sessionStorage.removeItem('hmb-profile-'+uid); }catch{}
  }
  sessionRestored = false;
  lastAuthUid = null;
  STATE.user = STATE.profile = STATE.role = null;
  STATE.deliveries = []; STATE.drivers = [];
  goTo('screen-home');
  showToast('👋 Sessão encerrada');
}

function firebaseErrorMsg(code, mode){
  if(code === 'auth/user-not-found'){
    return mode === 'reset'
      ? 'E-mail não cadastrado neste app.'
      : 'E-mail não encontrado. Crie uma conta na aba Criar Conta.';
  }
  const msgs = {
    'auth/wrong-password':'Senha incorreta.',
    'auth/invalid-email':'E-mail inválido.',
    'auth/email-already-in-use':'Este e-mail já está cadastrado. Use Entrar ou a senha correta.',
    'auth/weak-password':'Senha muito fraca (mínimo 6 caracteres).',
    'auth/invalid-credential': mode === 'login'
      ? 'E-mail ou senha incorretos. Se ainda não tem conta, use Criar Conta.'
      : 'Não foi possível criar a conta. Verifique os dados.',
    'auth/too-many-requests':'Muitas tentativas. Aguarde um minuto e tente de novo.',
    'auth/network-request-failed':'Sem conexão. Verifique a internet.',
    'auth/expired-action-code':'Código expirado. Peça um novo código.',
    'auth/invalid-action-code':'Código inválido. Verifique ou reenvie.',
    'auth/unauthorized-continue-uri':'Link de recuperação enviado. Use o e-mail do Firebase ou cole o código aqui.',
    'permission-denied':'Sem permissão no Firestore. Verifique as regras do Firebase.',
  };
  return msgs[code] || ('Erro: ' + (code || 'desconhecido'));
}

// ─────────────────────────────────────────────────────────────
// DRIVER SESSION
// ─────────────────────────────────────────────────────────────
function enterDriver(){
  try{
    const p = STATE.profile;
    document.getElementById('d-name').textContent       = p.name || 'Motorista';
    document.getElementById('d-topbar-name').textContent = p.name ? p.name.split(' ')[0] : 'Motorista';
    document.getElementById('d-vehicle').textContent    = p.vehicle ? '🚗 ' + p.vehicle : '🚗 Veículo não informado';
    document.getElementById('d-deliveries-today').textContent = '📦 ' + (p.deliveriesToday||0) + ' hoje';
    document.getElementById('driver-date').textContent  = fmtDate();
    hideLoading();
    goTo('screen-driver');
    renderDriverHistory();
    setInterval(()=>{ const el=document.getElementById('gps-time'); if(el) el.textContent='⏱ '+fmtTime(); }, 1000);
    requestAnimationFrame(()=>{
      startGPS();
      loadDriverHistory();
      loadDriverPendingDeliveries();
      loadDriverCompletedDeliveries();
    });
  }catch(err){
    console.error('enterDriver error:', err);
    hideLoading();
    goTo('screen-driver');
  }
}

async function loadDriverPendingDeliveries(){
  console.log('=== loadDriverPendingDeliveries iniciado ===');
  if(!STATE.user){
    console.error('Usuário não logado');
    return;
  }

  const container = document.getElementById('driver-pending-deliveries');
  if(!container){
    console.error('Container driver-pending-deliveries não encontrado');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar entregas</p>';
      return;
    }

    const {collection, query, where, orderBy, limit, getDocs} = window.$firebase;
    console.log('Buscando entregas pendentes...');
    const q = query(
      collection(window.$db, 'deliveries'),
      where('driverUid', '==', STATE.user.uid),
      where('status', 'in', ['pending', 'transit']),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    const deliveries = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Entregas pendentes encontradas:', deliveries.length);

    if(deliveries.length === 0){
      container.innerHTML = '<div class="empty-state"><div class="e-icon">📦</div><p>Nenhuma entrega pendente.<br>Suas entregas aparecerão aqui.</p></div>';
    } else {
      container.innerHTML = deliveries.map(d=>`
        <div class="delivery-card">
          <div class="delivery-thumb ${d.status==='transit'?'thumb-blue':'thumb-yellow'}">
            ${d.status==='transit'?'🔄':'⏳'}
          </div>
          <div class="delivery-body">
            <h4>${esc(d.client)}</h4>
            <p>📍 ${esc(d.addr)}</p>
            ${d.deliveryName ? `<p style="font-size:12px;color:var(--gray-500);">${esc(d.deliveryName)}</p>` : ''}
          </div>
          <div class="delivery-right">
            <span class="status-pill ${d.status==='transit'?'pill-blue':'pill-yellow'}">
              ${d.status==='transit'?'Em Trânsito':'Pendente'}
            </span>
            <div class="delivery-time">${d.time||'--'}</div>
          </div>
        </div>
      `).join('');
    }
    console.log('=== loadDriverPendingDeliveries concluído ===');
  } catch(e){
    console.error('Erro ao carregar entregas pendentes:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar entregas</p>';
  }
}

async function loadDriverCompletedDeliveries(){
  console.log('=== loadDriverCompletedDeliveries iniciado ===');
  if(!STATE.user){
    console.error('Usuário não logado');
    return;
  }

  const container = document.getElementById('driver-completed-deliveries');
  if(!container){
    console.error('Container driver-completed-deliveries não encontrado');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar entregas</p>';
      return;
    }

    const {collection, query, where, orderBy, limit, getDocs} = window.$firebase;
    console.log('Buscando entregas concluídas...');
    const q = query(
      collection(window.$db, 'deliveries'),
      where('driverUid', '==', STATE.user.uid),
      where('status', '==', 'done'),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    const deliveries = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Entregas concluídas encontradas:', deliveries.length);

    if(deliveries.length === 0){
      container.innerHTML = '<div class="empty-state"><div class="e-icon">✅</div><p>Nenhuma entrega concluída ainda.<br>Suas entregas aparecerão aqui.</p></div>';
    } else {
      container.innerHTML = deliveries.map(d=>`
        <div class="delivery-card">
          <div class="delivery-thumb thumb-green">✅</div>
          <div class="delivery-body">
            <h4>${esc(d.client)}</h4>
            <p>📍 ${esc(d.addr)}</p>
            ${d.deliveryName ? `<p style="font-size:12px;color:var(--gray-500);">${esc(d.deliveryName)}</p>` : ''}
          </div>
          <div class="delivery-right">
            <span class="status-pill pill-green">Concluída</span>
            <div class="delivery-time">${d.finishedAt||d.time||'--'}</div>
          </div>
        </div>
      `).join('');
    }
    console.log('=== loadDriverCompletedDeliveries concluído ===');
  } catch(e){
    console.error('Erro ao carregar entregas concluídas:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar entregas</p>';
  }
}

async function loadDriverDeliveries(){
  console.log('=== loadDriverDeliveries iniciado ===');
  if(!STATE.user){
    console.error('Usuário não logado');
    return;
  }

  const container = document.getElementById('driver-deliveries-list');
  if(!container){
    console.error('Container driver-deliveries-list não encontrado');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar entregas</p>';
      return;
    }

    const {collection, query, where, orderBy, limit, getDocs} = window.$firebase;
    console.log('Buscando entregas do motorista...');
    const q = query(
      collection(window.$db, 'deliveries'),
      where('driverUid', '==', STATE.user.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const snap = await getDocs(q);
    const deliveries = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Entregas encontradas:', deliveries.length);

    if(deliveries.length === 0){
      container.innerHTML = '<div class="empty-state"><div class="e-icon">📦</div><p>Nenhuma entrega encontrada.<br>Suas entregas aparecerão aqui.</p></div>';
    } else {
      container.innerHTML = deliveries.map(d=>`
        <div class="delivery-card">
          <div class="delivery-thumb ${d.status==='done'?'thumb-green':d.status==='transit'?'thumb-blue':d.status==='pending'?'thumb-yellow':'thumb-red'}">
            ${d.status==='done'?'✅':d.status==='transit'?'🔄':d.status==='pending'?'⏳':'❌'}
          </div>
          <div class="delivery-body">
            <h4>${esc(d.client)}</h4>
            <p>📍 ${esc(d.addr)}</p>
            ${d.deliveryName ? `<p style="font-size:12px;color:var(--gray-500);">${esc(d.deliveryName)}</p>` : ''}
          </div>
          <div class="delivery-right">
            <span class="status-pill ${d.status==='done'?'pill-green':d.status==='transit'?'pill-blue':d.status==='pending'?'pill-yellow':'pill-red'}">
              ${d.status==='done'?'Concluída':d.status==='transit'?'Em Trânsito':d.status==='pending'?'Pendente':'Cancelada'}
            </span>
            <div class="delivery-time">${d.time||'--'}</div>
          </div>
        </div>
      `).join('');
    }
    console.log('=== loadDriverDeliveries concluído ===');
  } catch(e){
    console.error('Erro ao carregar entregas:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar entregas</p>';
  }
}

async function loadDriverHistory(){
  console.log('=== loadDriverHistory iniciado ===');
  if(!STATE.user){
    console.error('Usuário não logado');
    return;
  }

  const container = document.getElementById('driver-history');
  if(!container){
    console.error('Container driver-history não encontrado');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar histórico</p>';
      return;
    }

    const {collection, query, where, orderBy, limit, getDocs} = window.$firebase;
    console.log('Buscando histórico de entregas...');
    const q = query(
      collection(window.$db, 'deliveries'),
      where('driverUid', '==', STATE.user.uid),
      where('status', '==', 'done'),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    const history = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Histórico encontrado:', history.length);

    if(history.length === 0){
      container.innerHTML = '<div class="empty-state"><div class="e-icon">📋</div><p>Nenhuma entrega realizada ainda.<br>Suas entregas concluídas aparecerão aqui.</p></div>';
    } else {
      container.innerHTML = history.map(d=>`
        <div class="delivery-card">
          <div class="delivery-thumb thumb-green">✅</div>
          <div class="delivery-body">
            <h4>${esc(d.client)}</h4>
            <p>📍 ${esc(d.addr)}</p>
            ${d.deliveryName ? `<p style="font-size:12px;color:var(--gray-500);">${esc(d.deliveryName)}</p>` : ''}
          </div>
          <div class="delivery-right">
            <span class="status-pill pill-green">Entregue</span>
            <div class="delivery-time">${d.finishedAt||d.time||'--'}</div>
          </div>
        </div>
      `).join('');
    }
    console.log('=== loadDriverHistory concluído ===');
  } catch(e){
    console.error('Erro ao carregar histórico:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    container.innerHTML = '<p style="font-size:13px;color:var(--red);">Erro ao carregar histórico</p>';
  }
}

// ─────────────────────────────────────────────────────────────
// GPS
// ─────────────────────────────────────────────────────────────
function requestGPSPermission(){
  if(!navigator.geolocation){
    document.getElementById('gps-address').textContent='GPS não disponível neste dispositivo.';
    return false;
  }
  if(location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    document.getElementById('gps-address').textContent='📍 GPS exige HTTPS ou localhost. Abra pelo celular com link seguro.';
    return false;
  }
  return true;
}

function startGPS(){
  if(!requestGPSPermission()) return;

  document.getElementById('gps-address').textContent='📍 Solicitando permissão de GPS...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('gps-address').textContent='📍 GPS ativo!';
      STATE.gpsWatchId = navigator.geolocation.watchPosition(pos=>{
        const {latitude:lat, longitude:lng, accuracy, speed} = pos.coords;
        document.getElementById('gps-coords').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        document.getElementById('gps-acc').textContent = Math.round(accuracy);
        document.getElementById('gps-spd').textContent = speed ? Math.round(speed*3.6) : '0';
        saveDriverLocation(lat, lng);
        if(!STATE._geoBusy) reverseGeocode(lat, lng);
      }, (err)=>{
        document.getElementById('gps-coords').textContent='GPS: sem sinal';
        const msgs={
          1:'📍 Ative a localização do celular nas configurações.',
          2:'📍 Permita localização para o HMB Track no navegador.',
          3:'📍 Aguardando sinal GPS...'
        };
        document.getElementById('gps-address').textContent=msgs[err?.code]||'📍 Não foi possível obter localização.';
      }, {enableHighAccuracy:true, maximumAge:10000, timeout:15000});
    },
    (err) => {
      document.getElementById('gps-coords').textContent='GPS: sem sinal';
      const msgs={
        1:'📍 Ative a localização do celular nas configurações.',
        2:'📍 Permita localização para o HMB Track no navegador.',
        3:'📍 Aguardando sinal GPS...'
      };
      document.getElementById('gps-address').textContent=msgs[err?.code]||'📍 Não foi possível obter localização.';
    },
    {enableHighAccuracy:true, maximumAge:10000, timeout:15000}
  );
}

let _geocodeTimer;
function reverseGeocode(lat, lng){
  clearTimeout(_geocodeTimer);
  _geocodeTimer = setTimeout(async()=>{
    if(STATE._geoBusy) return;
    STATE._geoBusy = true;
    try{
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
      const d = await r.json();
      const addr = d.display_name || 'Localização obtida';
      document.getElementById('gps-address').textContent = '📍 ' + addr.substring(0,80);
    } catch {
      document.getElementById('gps-address').textContent = '📍 Localização GPS ativa';
    } finally {
      STATE._geoBusy = false;
    }
  }, 12000);
}

async function saveDriverLocation(lat, lng){
  if(!STATE.user) return;
  const now = Date.now();
  if(now - lastLocationSave < 45000) return;
  lastLocationSave = now;
  try{
    const {doc, updateDoc, serverTimestamp} = window.$firebase;
    await updateDoc(doc(window.$db,'users',STATE.user.uid), {
      lat, lng, online: true, lastSeen: serverTimestamp()
    });
  } catch{}
}

// ─────────────────────────────────────────────────────────────
// DRIVER ACTIONS
// ─────────────────────────────────────────────────────────────
const STEPS = {
  0:{next:1,enable:['btn-arrive'],disable:['btn-start'],text:'🔵 Em rota — Dirija ao cliente',badge:'🔵 Em Rota'},
  1:{next:2,enable:['btn-finish'],disable:['btn-arrive'],text:'🟡 No cliente — Aguardando confirmação',badge:'🟡 No Cliente'},
  2:{next:3,enable:[],disable:['btn-finish'],text:'✅ Entrega concluída com sucesso!',badge:'🟢 Livre'},
};

function driverAction(act){
  if(act==='start'){
    const deliveryNameInput = document.getElementById('home-delivery-name');
    const clientNameInput = document.getElementById('home-client-name');
    const deliveryName = deliveryNameInput ? deliveryNameInput.value.trim() : '';
    const clientName = clientNameInput ? clientNameInput.value.trim() : '';
    STATE.currentDeliveryName = deliveryName || 'Entrega sem nome';
    STATE.currentClientName = clientName || 'Cliente não informado';

    // Limpa os campos após usar
    if(deliveryNameInput) deliveryNameInput.value = '';
    if(clientNameInput) clientNameInput.value = '';
  }

  const map = {start:0, arrive:1, finish:2};
  const cfg = STEPS[map[act]];
  if(!cfg) return;
  STATE.driverStep = cfg.next;
  for(let i=0; i<=cfg.next; i++){
    const s = document.getElementById('step-'+i);
    if(s) s.className='step-item '+(i<cfg.next?'done':i===cfg.next?'active-step':'');
  }
  document.getElementById('status-text').textContent = cfg.text;
  cfg.enable.forEach(b=>{const el=document.getElementById(b);if(el)el.disabled=false;});
  cfg.disable.forEach(b=>{const el=document.getElementById(b);if(el)el.disabled=true;});
  document.getElementById('d-status-badge').textContent = cfg.badge;
  showToast(cfg.text);

  if(act==='finish'){
    recordDeliveryFinish();
    setTimeout(()=>{
      STATE.driverStep=0;
      ['step-0','step-1','step-2','step-3'].forEach((id,i)=>{
        const el=document.getElementById(id);
        if(el) el.className='step-item '+(i===0?'done':i===1?'active-step':'');
      });
      document.getElementById('status-text').textContent='🔵 Aguardando início da rota';
      document.getElementById('btn-start').disabled=false;
      document.getElementById('btn-arrive').disabled=true;
      document.getElementById('btn-finish').disabled=true;
      document.getElementById('d-status-badge').textContent='🟢 Online';
      showToast('🎉 Pronto para nova entrega!');
    }, 500);
  }
}

async function recordDeliveryFinish(){
  if(!STATE.user) return;
  const today = fmtTime();
  const prev = parseInt(document.getElementById('d-deliveries-today').textContent.match(/\d+/)[0])||0;
  document.getElementById('d-deliveries-today').textContent = '📦 '+(prev+1)+' hoje';

  try{
    const {doc, updateDoc, serverTimestamp, collection, addDoc} = window.$firebase;

    // Atualiza contador do motorista
    await updateDoc(doc(window.$db,'users',STATE.user.uid), {
      deliveriesToday: prev+1,
      totalDeliveries: (STATE.profile.totalDeliveries||0)+1
    });
    STATE.profile.deliveriesToday = prev+1;

    // Cria registro da entrega no Firestore para o admin ver
    await addDoc(collection(window.$db,'deliveries'), {
      client: STATE.currentClientName || 'Cliente não informado',
      addr: 'Entrega iniciada pelo motorista',
      deliveryName: STATE.currentDeliveryName || 'Entrega sem nome',
      driverUid: STATE.user.uid,
      driver: STATE.profile?.name || 'Motorista',
      status: 'done',
      priority: 'Normal',
      obs: 'Entrega iniciada e finalizada pelo motorista',
      adminCode: STATE.profile?.adminCode || '',
      time: fmtTime(),
      finishedAt: fmtTime(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  } catch(e){
    console.warn('Erro ao salvar entrega:', e);
  }
  loadDriverHistory();
}

function driverNavTab(btn, tab){
  document.querySelectorAll('#screen-driver .nav-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const sc = document.getElementById('driver-scroll');

  if(tab==='home'){
    sc.scrollTo({top:0, behavior:'smooth'});
  } else if(tab==='map'){
    document.querySelector('.gps-card')?.scrollIntoView({behavior:'smooth'});
  } else if(tab==='history'){
    sc.scrollTo({top:sc.scrollHeight, behavior:'smooth'});
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN SESSION
// ─────────────────────────────────────────────────────────────
let chartInstance = null;

function enterAdmin(){
  console.log('=== enterAdmin iniciado ===');
  try{
    document.getElementById('admin-date').textContent = fmtDate();

    // Verificar se admin tem nome da empresa configurado
    console.log('Verificando se admin tem nome da empresa...');
    console.log('STATE.profile:', STATE.profile);
    console.log('STATE.profile?.empresaId:', STATE.profile?.empresaId);
    if(!STATE.profile?.empresaId){
      console.log('Admin não tem empresa configurada, abrindo modal...');
      openModal('modal-setup-company');
      return;
    }

    const codeDisplay = document.getElementById('admin-code-display');
    if(codeDisplay){
      codeDisplay.textContent = STATE.profile.nomeEmpresa;
    }

    hideLoading();
    goTo('screen-admin');
    adminTab('drivers');
    if(!STATE.unsubDeliveries) subscribeDeliveries();
    if(!STATE.unsubDrivers) subscribeDrivers();
    if(!STATE.unsubRequests) subscribeRequests();
    requestAnimationFrame(()=>setTimeout(initAdminChart, 80));
    console.log('=== enterAdmin concluído ===');
  }catch(err){
    console.error('enterAdmin error:', err);
    hideLoading();
    goTo('screen-admin');
  }
}

function subscribeDeliveries(){
  if(STATE.unsubDeliveries) STATE.unsubDeliveries();
  const {collection, query, orderBy, limit, onSnapshot} = window.$firebase;
  const q = query(collection(window.$db,'deliveries'), orderBy('createdAt','desc'), limit(30));
  STATE.unsubDeliveries = onSnapshot(q, snap=>{
    STATE.deliveries = snap.docs.map(d=>({id:d.id,...d.data()}));
    updateAdminCounters();
    if(STATE.adminCurTab==='deliveries') renderAdminTab('deliveries');
    if(STATE.adminCurTab==='reports') renderAdminTab('reports');
    updateDriverSelect();
    updateAdminChart();
  }, ()=>{});
}

function subscribeDrivers(){
  console.log('=== subscribeDrivers iniciado ===');
  if(STATE.unsubDrivers) STATE.unsubDrivers();
  const {collection, query, where, limit, onSnapshot} = window.$firebase;
  const adminUid = STATE.user?.uid || '';
  console.log('Admin UID:', adminUid);
  console.log('Firebase disponível?', !!window.$firebase);
  console.log('Firestore disponível?', !!window.$db);

  if(!window.$firebase || !window.$db){
    console.error('Firebase não inicializado');
    return;
  }

  // Filtrar motoristas conectados a este admin pelo adminUid
  console.log('Buscando motoristas conectados a este admin...');
  let q = query(collection(window.$db,'users'), where('role','==','driver'), where('adminUid','==',adminUid), limit(50));

  STATE.unsubDrivers = onSnapshot(q, snap=>{
    console.log('Motoristas encontrados:', snap.docs.length);
    STATE.drivers = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Dados dos motoristas:', STATE.drivers);
    if(STATE.adminCurTab==='drivers') renderAdminTab('drivers');
    updateDriverSelect();
    updateMapPins();
    document.getElementById('map-active-count').textContent =
      STATE.drivers.filter(d=>d.online).length + ' motoristas ativos';
    document.getElementById('map-avg-del').textContent =
      STATE.deliveries.length;
  }, (err)=>{
    console.error('Erro ao buscar motoristas:', err);
    console.error('Código do erro:', err?.code);
    console.error('Mensagem do erro:', err?.message);
  });
  console.log('=== subscribeDrivers configurado ===');
}

function updateDriverSelect(){
  const sel = document.getElementById('f-driver');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Selecionar motorista</option>' +
    STATE.drivers.map(d=>`<option value="${esc(d.uid||d.id)}">${esc(d.name)}</option>`).join('');
  sel.value = cur;

  // Atualiza dropdown do mapa também
  const mapSel = document.getElementById('map-driver-select');
  if(mapSel){
    const mapCur = mapSel.value;
    mapSel.innerHTML = '<option value="">Selecione um motorista</option>' +
      STATE.drivers.map(d=>`<option value="${esc(d.uid||d.id)}">${esc(d.name)}</option>`).join('');
    mapSel.value = mapCur;
  }
}

function updateMapPins(){
  const container = document.getElementById('map-pins');
  if(!container) return;
  const onlineDrivers = STATE.drivers.filter(d=>d.online && d.lat);
  if(!onlineDrivers.length){
    container.innerHTML='';
    return;
  }
  // Distribute pins visually (real map would use lat/lng → pixel)
  const positions = [{left:'35%',top:'42%'},{left:'68%',top:'67%'},{left:'55%',top:'30%'},{left:'25%',top:'60%'}];
  container.innerHTML = onlineDrivers.slice(0,4).map((d,i)=>{
    const p = positions[i]||{left:'50%',top:'50%'};
    return `<div class="map-pulse" style="left:${p.left};top:${p.top};animation-delay:${i*0.4}s;"></div>
            <div class="map-pin" style="left:${p.left};top:${p.top};animation-delay:${i*0.6}s;" title="${esc(d.name)}">📍</div>`;
  }).join('');
}

function showDriverLocation(){
  const sel = document.getElementById('map-driver-select');
  const infoDiv = document.getElementById('driver-location-info');
  const infoText = document.getElementById('driver-location-text');

  if(!sel || !infoDiv || !infoText) return;

  const driverUid = sel.value;
  if(!driverUid){
    infoDiv.style.display = 'none';
    return;
  }

  const driver = STATE.drivers.find(d=>(d.uid||d.id)===driverUid);
  if(!driver){
    infoDiv.style.display = 'none';
    return;
  }

  infoDiv.style.display = 'block';

  if(driver.lat && driver.lng){
    infoText.innerHTML = `📍 ${driver.name}<br>🧭 Lat: ${driver.lat.toFixed(6)}, Lng: ${driver.lng.toFixed(6)}<br>🚗 Online`;
  } else {
    infoText.innerHTML = `📍 ${driver.name}<br>⚠️ Motorista não está sobre rastreamento via celular<br>📱 Verifique se o GPS está ativo`;
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN TAB RENDERING
// ─────────────────────────────────────────────────────────────
function adminTab(tab){
  STATE.adminCurTab = tab;
  ['drivers','deliveries','reports'].forEach(t=>{
    document.getElementById('tab-'+t)?.classList.toggle('on', t===tab);
    document.getElementById('tab-'+t+'-d')?.classList.toggle('on', t===tab);
    adminSideHighlight(document.querySelector(`#admin-sidebar .side-link[data-admin-tab="${tab}"]`));
  });
  renderAdminTab(tab);
}

function renderAdminTab(tab){
  const el = document.getElementById('admin-tab-content');
  if(!el) return;
  if(tab==='drivers')    el.innerHTML = renderDrivers();
  else if(tab==='deliveries') el.innerHTML = renderDeliveries();
  else el.innerHTML = renderReports();
}

function renderDrivers(){
  let html = '';

  // Mostrar solicitações pendentes primeiro
  if(STATE.requests && STATE.requests.length > 0){
    html += `<div class="sec-title" style="margin-bottom:8px;">📨 Solicitações Pendentes (${STATE.requests.length})</div>`;
    html += STATE.requests.map(r=>`
      <div class="driver-row" style="background:var(--yellow);border:1px solid var(--yellow);">
        <div class="driver-av">📨</div>
        <div class="driver-details">
          <h4>${esc(r.driverName)}</h4>
          <p>Deseja entrar na empresa: <strong>${esc(r.empresaNome)}</strong></p>
        </div>
        <div class="driver-status-col">
          <button class="action-btn btn-green" onclick="showRequestModal(${JSON.stringify(r).replace(/"/g, '&quot;')})" style="padding:8px 12px;font-size:12px;">Ver</button>
        </div>
      </div>
    `).join('');
  }

  // Mostrar motoristas conectados
  if(!STATE.drivers.length && !STATE.requests?.length){
    return `<div class="empty-state"><div class="e-icon">🧑‍✈️</div><p>Nenhum motorista conectado.<br>Motoristas solicitam acesso pelo nome da empresa: <strong>${STATE.profile?.nomeEmpresa || '...'}</strong></p></div>`;
  }

  if(STATE.drivers.length > 0){
    html += `<div class="sec-title" style="margin-top:16px;margin-bottom:8px;">🧑‍✈️ Motoristas Conectados</div>`;
    html += STATE.drivers.slice(0, 50).map(d=>`
      <div class="driver-row">
        <div class="driver-av">🧑‍✈️</div>
        <div class="driver-details">
          <h4>${esc(d.name)}</h4>
          <p>${d.vehicle ? '🚗 '+esc(d.vehicle) : '🚗 Veículo não informado'}</p>
          <div class="driver-meta">
            <span class="meta-chip">📦 ${d.deliveriesToday||0} hoje</span>
            <span class="meta-chip">📊 ${d.totalDeliveries||0} total</span>
            ${d.lat ? `<span class="meta-chip">📍 GPS ativo</span>` : ''}
            ${d.lastSeen ? `<span class="meta-chip">⏱ ${formatLastSeen(d.lastSeen)}</span>` : ''}
          </div>
        </div>
        <div class="driver-status-col">
          <div class="online-badge ${d.online?'on':'off'}">
            <div class="o-dot ${d.online?'on':'off'}"></div>
            ${d.online?'Online':'Offline'}
          </div>
        </div>
      </div>`).join('');
  }

  return html;
}

function formatLastSeen(timestamp){
  if(!timestamp) return '--';
  const now = new Date();
  const last = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const diff = Math.floor((now - last) / 1000 / 60); // minutos
  if(diff < 1) return 'Agora mesmo';
  if(diff < 60) return `${diff} min atrás`;
  const hours = Math.floor(diff / 60);
  if(hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

function renderDeliveries(){
  if(!STATE.deliveries.length)
    return `<div class="empty-state"><div class="e-icon">📦</div><p>Nenhuma entrega cadastrada ainda.<br>Clique em "+ Nova Entrega" para começar.</p></div>`;
  const cfg={
    done:{icon:'✅',thumb:'thumb-green',pill:'pill-green',label:'Concluída'},
    transit:{icon:'🔄',thumb:'thumb-blue',pill:'pill-blue',label:'Em Trânsito'},
    pending:{icon:'⏳',thumb:'thumb-yellow',pill:'pill-yellow',label:'Pendente'},
    cancelled:{icon:'❌',thumb:'thumb-red',pill:'pill-red',label:'Cancelada'},
  };
  return STATE.deliveries.slice(0, 30).map(d=>{
    const c = cfg[d.status]||cfg.pending;
    const dName = STATE.drivers.find(dr=>(dr.uid||dr.id)===d.driverUid)?.name || d.driver || 'Não atribuído';
    return `
    <div class="delivery-card" style="cursor:pointer;" onclick="openStatusModal('${d.id}')">
      <div class="delivery-thumb ${c.thumb}">${c.icon}</div>
      <div class="delivery-body">
        <h4>${esc(d.client)}</h4>
        <p>📍 ${esc(d.addr)}</p>
        <p style="margin-top:5px;">🧑‍✈️ ${esc(dName)} &nbsp;·&nbsp; 🏷️ ${esc(d.priority||'Normal')}</p>
      </div>
      <div class="delivery-right">
        <span class="status-pill ${c.pill}">${c.label}</span>
        <div class="delivery-time">${d.time||'--'}</div>
        <div style="font-size:11px;color:var(--blue-600);margin-top:4px;font-weight:700;">Editar ›</div>
      </div>
    </div>`}).join('');
}

function renderReports(){
  const total = STATE.deliveries.length;
  const done = STATE.deliveries.filter(x=>x.status==='done').length;
  const transit = STATE.deliveries.filter(x=>x.status==='transit').length;
  const pending = STATE.deliveries.filter(x=>x.status==='pending').length;
  const cancelled = STATE.deliveries.filter(x=>x.status==='cancelled').length;
  if(!total)
    return `<div class="empty-state"><div class="e-icon">📈</div><p>Nenhum dado disponível ainda.<br>Os relatórios serão gerados conforme as entregas forem realizadas.</p></div>`;
  return `
  <div class="chart-card">
    <h4>🥧 Distribuição de Status</h4>
    <div class="chart-wrap"><canvas id="chart-pie" data-done="${done}" data-transit="${transit}" data-pending="${pending}" data-cancelled="${cancelled}"></canvas></div>
  </div>
  <div class="stat-grid" style="margin-top:0;">
    <div class="stat-card blue-accent"><div class="s-icon">📦</div><div class="s-val">${total}</div><div class="s-lbl">Total</div></div>
    <div class="stat-card green-accent"><div class="s-icon">✅</div><div class="s-val">${total?Math.round(done/total*100):0}%</div><div class="s-lbl">Taxa Conclusão</div></div>
    <div class="stat-card yellow-accent"><div class="s-icon">🔄</div><div class="s-val">${transit}</div><div class="s-lbl">Em Trânsito</div></div>
    <div class="stat-card red-accent"><div class="s-icon">⏳</div><div class="s-val">${pending}</div><div class="s-lbl">Pendentes</div></div>
  </div>`;
}

// Pie chart (lazy)
document.addEventListener('click', e=>{
  const c = document.getElementById('chart-pie');
  if(c && !c._chart && document.getElementById('admin-tab-content')?.contains(e.target)){
    c._chart = true;
    loadChartJS();
    const done=parseInt(c.dataset.done)||0, transit=parseInt(c.dataset.transit)||0,
          pending=parseInt(c.dataset.pending)||0, cancelled=parseInt(c.dataset.cancelled)||0;
    new Chart(c,{
      type:'doughnut',
      data:{labels:['Concluídas','Em Trânsito','Pendentes','Canceladas'],
        datasets:[{data:[done,transit,pending,cancelled],backgroundColor:['#10b981','#1c64f2','#f59e0b','#ef4444'],borderWidth:0,hoverOffset:8}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'right',labels:{font:{size:12},color:'#475569',boxWidth:12}}}}
    });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN CHART (bar)
// ─────────────────────────────────────────────────────────────
function initAdminChart(){
  const ctx = document.getElementById('chart-week');
  if(!ctx) return;
  loadChartJS();
  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx,{
    type:'bar',
    data:{
      labels:['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'],
      datasets:[
        {label:'Concluídas',data:[0,0,0,0,0,0,0],backgroundColor:'rgba(26,86,219,.8)',borderRadius:8,borderSkipped:false},
        {label:'Pendentes', data:[0,0,0,0,0,0,0],backgroundColor:'rgba(245,158,11,.7)',borderRadius:8,borderSkipped:false}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,position:'top',labels:{font:{size:11,weight:'bold'},color:'#64748b',boxWidth:10}}},
      scales:{
        x:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:11}}},
        y:{grid:{color:'rgba(226,232,240,.5)'},ticks:{color:'#94a3b8',font:{size:11}},beginAtZero:true}
      }
    }
  });
}

function updateAdminChart(){
  if(!chartInstance) return;
  // Build last-7-days data dynamically from Firestore deliveries
  const days = Array(7).fill(0).map((_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-6+i);
    return d.toLocaleDateString('pt-BR',{weekday:'short'});
  });
  const doneData   = Array(7).fill(0);
  const pendData   = Array(7).fill(0);
  STATE.deliveries.forEach(del=>{
    if(!del.createdAt?.seconds) return;
    const d = new Date(del.createdAt.seconds*1000);
    const label = d.toLocaleDateString('pt-BR',{weekday:'short'});
    const idx = days.indexOf(label);
    if(idx<0) return;
    if(del.status==='done') doneData[idx]++;
    else if(del.status==='pending') pendData[idx]++;
  });
  chartInstance.data.labels = days;
  chartInstance.data.datasets[0].data = doneData;
  chartInstance.data.datasets[1].data = pendData;
  chartInstance.update('none');
}

// ─────────────────────────────────────────────────────────────
// ADMIN ACTIONS
// ─────────────────────────────────────────────────────────────
function updateAdminCounters(){
  const total = STATE.deliveries.length;
  const done  = STATE.deliveries.filter(d=>d.status==='done').length;
  const tra   = STATE.deliveries.filter(d=>d.status==='transit').length;
  const pend  = STATE.deliveries.filter(d=>d.status==='pending').length;
  document.getElementById('a-total').textContent = total;
  document.getElementById('a-done').textContent  = done;
  document.getElementById('a-transit').textContent = tra;
  document.getElementById('a-pending').textContent = pend;
}

async function createDelivery(){
  const name     = document.getElementById('f-name').value.trim();
  const street   = document.getElementById('f-street').value.trim();
  const number   = document.getElementById('f-number').value.trim();
  const neighborhood = document.getElementById('f-neighborhood').value.trim();
  const city     = document.getElementById('f-city').value.trim();
  const driverUid= document.getElementById('f-driver').value;
  const priority = document.getElementById('f-priority').value;
  const obs      = document.getElementById('f-obs').value.trim();
  if(!name || !street){ showToast('⚠️ Preencha nome do cliente e rua'); return; }

  const addr = `${street}, ${number || 'S/N'} - ${neighborhood || ''}, ${city || ''}`;
  const driverName = STATE.drivers.find(d=>(d.uid||d.id)===driverUid)?.name || '';
  try{
    const {collection, addDoc, serverTimestamp} = window.$firebase;
    await addDoc(collection(window.$db,'deliveries'), {
      client:name, addr, street, number, neighborhood, city,
      driverUid, driver:driverName, priority, obs,
      status:'pending', time:fmtTime(),
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    ['f-name','f-street','f-number','f-neighborhood','f-city','f-obs'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('f-driver').value='';
    closeModal('modal-new');
    showToast('✅ Entrega criada!');
    adminTab('deliveries');
  } catch(e){
    showToast('❌ Erro ao criar entrega: '+e.message);
  }
}

async function createDriver(){
  const name    = document.getElementById('d-name-new').value.trim();
  const email   = document.getElementById('d-email-new').value.trim().toLowerCase();
  const pass    = document.getElementById('d-pass-new').value;
  const vehicle = document.getElementById('d-vehicle-new').value.trim();
  if(!name || !email || !pass){ showToast('⚠️ Preencha nome, e-mail e senha'); return; }
  if(pass.length < 6){ showToast('⚠️ Senha deve ter pelo menos 6 caracteres'); return; }

  try{
    const {createUserWithEmailAndPassword, updateProfile, doc, setDoc, serverTimestamp} = window.$firebase;
    const cred = await createUserWithEmailAndPassword(window.$auth, email, pass);
    await updateProfile(cred.user, {displayName: name});

    const driverData = {
      uid: cred.user.uid,
      name: name,
      email: email,
      role: 'driver',
      vehicle: vehicle || '',
      deliveriesToday: 0,
      totalDeliveries: 0,
      online: true,
      adminCode: STATE.profile?.adminCode || '',
      createdAt: serverTimestamp()
    };

    await setDoc(doc(window.$db,'users',cred.user.uid), driverData);

    ['d-name-new','d-email-new','d-pass-new','d-vehicle-new'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    closeModal('modal-new-driver');
    showToast('✅ Motorista cadastrado com sucesso!');
  } catch(e){
    showToast('❌ Erro ao cadastrar motorista: '+e.message);
  }
}

async function createReport(){
  const title = document.getElementById('report-title').value.trim();
  const desc = document.getElementById('report-desc').value.trim();
  if(!title){ showToast('⚠️ Preencha o título do relatório'); return; }

  try{
    const {collection, addDoc, serverTimestamp} = window.$firebase;
    await addDoc(collection(window.$db,'reports'), {
      title: title,
      description: desc,
      driverUid: STATE.user.uid,
      driverName: STATE.profile?.name || '',
      adminCode: STATE.profile?.adminCode || '',
      createdAt: serverTimestamp()
    });

    document.getElementById('report-title').value = '';
    document.getElementById('report-desc').value = '';
    closeModal('modal-new-report');
    showToast('✅ Relatório criado com sucesso!');
  } catch(e){
    showToast('❌ Erro ao criar relatório: '+e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SISTEMA DE NOME ÚNICO DA EMPRESA
// ─────────────────────────────────────────────────────────────
let currentRequestId = null;

async function setupCompanyName(e){
  console.log('=== setupCompanyName iniciado ===');
  const btn = e?.target || document.getElementById('btn-setup-company');
  showLoading(btn);
  
  if(!STATE.user || !STATE.user.uid){
    console.error('Usuário não logado');
    if(btn) hideLoading(btn);
    showToast('⚠️ Usuário não logado');
    return;
  }

  const companyName = document.getElementById('company-name-input').value.trim().toUpperCase();
  console.log('Nome da empresa digitado:', companyName);
  if(!companyName || companyName.length < 3){
    console.error('Nome inválido:', companyName);
    if(btn) hideLoading(btn);
    showToast('⚠️ Nome da empresa deve ter pelo menos 3 caracteres');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      if(btn) hideLoading(btn);
      showToast('⚠️ Firebase não inicializado. Aguarde...');
      return;
    }

    const {collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp} = window.$firebase;

    // Verificar se nome já existe na collection empresas
    console.log('Verificando se nome já existe...');
    const q = query(collection(window.$db,'empresas'), where('nomeEmpresa','==',companyName));
    const snap = await getDocs(q);
    console.log('Resultado da busca:', snap.empty ? 'Nome disponível' : 'Nome já em uso');

    if(!snap.empty){
      console.error('Nome já em uso');
      if(btn) hideLoading(btn);
      showToast('❌ Este nome já está em uso. Escolha outro.');
      return;
    }

    // Criar documento na collection empresas
    console.log('Criando documento na collection empresas...');
    const empresaRef = await addDoc(collection(window.$db,'empresas'), {
      nomeEmpresa: companyName,
      adminUid: STATE.user.uid,
      createdAt: serverTimestamp()
    });
    console.log('Empresa criada com ID:', empresaRef.id);

    // Atualizar usuário com empresaId e nomeEmpresa
    console.log('Atualizando usuário com empresaId e nomeEmpresa...');
    await updateDoc(doc(window.$db,'users',STATE.user.uid), {
      empresaId: empresaRef.id,
      nomeEmpresa: companyName,
      companySetupAt: serverTimestamp()
    });
    console.log('Usuário atualizado com sucesso');

    if(STATE.profile){
      STATE.profile.empresaId = empresaRef.id;
      STATE.profile.nomeEmpresa = companyName;
      saveProfileToSession(STATE.user.uid, STATE.profile);
      console.log('Perfil atualizado localmente');
    }

    document.getElementById('company-name-input').value = '';
    closeModal('modal-setup-company');
    if(btn) hideLoading(btn);
    showToast('✅ Empresa configurada com sucesso!');
    console.log('=== setupCompanyName concluído com sucesso ===');
    enterAdmin();
  } catch(e){
    console.error('Erro ao configurar empresa:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    if(btn) hideLoading(btn);
    showToast('❌ Erro ao configurar empresa: '+e.message);
  }
}

async function requestJoinCompany(e){
  console.log('=== requestJoinCompany iniciado ===');
  const btn = e?.target || document.getElementById('btn-request-join');
  showLoading(btn);
  
  if(!STATE.user || !STATE.user.uid){
    console.error('Usuário não logado');
    if(btn) hideLoading(btn);
    showToast('⚠️ Usuário não logado');
    return;
  }

  const companyName = document.getElementById('join-company-name').value.trim().toUpperCase();
  console.log('Nome da empresa digitado:', companyName);
  if(!companyName || companyName.length < 3){
    console.error('Nome inválido:', companyName);
    if(btn) hideLoading(btn);
    showToast('⚠️ Nome da empresa deve ter pelo menos 3 caracteres');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      if(btn) hideLoading(btn);
      showToast('⚠️ Firebase não inicializado. Aguarde...');
      return;
    }

    const {collection, query, where, getDocs, addDoc, serverTimestamp} = window.$firebase;

    // Buscar empresa pelo nome
    console.log('Buscando empresa pelo nome:', companyName);
    const q = query(collection(window.$db,'empresas'), where('nomeEmpresa','==',companyName));
    const snap = await getDocs(q);
    console.log('Empresas encontradas:', snap.docs.length);

    if(snap.empty){
      console.error('Empresa não encontrada');
      if(btn) hideLoading(btn);
      showToast('❌ Empresa não encontrada. Verifique o nome.');
      return;
    }

    const empresaDoc = snap.docs[0];
    const empresaData = empresaDoc.data();
    console.log('Empresa encontrada:', empresaData.nomeEmpresa, 'ID:', empresaDoc.id);

    // Verificar se já existe solicitação
    console.log('Verificando se já existe solicitação...');
    const q2 = query(collection(window.$db,'solicitacoes'), where('driverUid','==',STATE.user.uid), where('empresaId','==',empresaDoc.id), where('status','==','pending'));
    const snap2 = await getDocs(q2);
    console.log('Solicitações existentes:', snap2.docs.length);

    if(!snap2.empty){
      console.error('Solicitação já enviada');
      if(btn) hideLoading(btn);
      showToast('⚠️ Você já enviou uma solicitação para esta empresa.');
      return;
    }

    // Criar solicitação
    console.log('Criando solicitação...');
    await addDoc(collection(window.$db,'solicitacoes'), {
      driverUid: STATE.user.uid,
      driverName: STATE.profile?.name || 'Motorista',
      empresaId: empresaDoc.id,
      empresaNome: empresaData.nomeEmpresa,
      adminUid: empresaData.adminUid,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    console.log('Solicitação criada com sucesso');

    document.getElementById('join-company-name').value = '';
    closeModal('modal-join-company');
    if(btn) hideLoading(btn);
    showToast('✅ Solicitação enviada! Aguarde aprovação.');
    console.log('=== requestJoinCompany concluído com sucesso ===');
    loadCompanyStatus();
  } catch(e){
    console.error('Erro ao solicitar acesso:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    if(btn) hideLoading(btn);
    showToast('❌ Erro ao solicitar acesso: '+e.message);
  }
}

function subscribeRequests(){
  console.log('=== subscribeRequests iniciado ===');
  if(STATE.unsubRequests) STATE.unsubRequests();
  if(!STATE.user || STATE.profile?.role !== 'admin'){
    console.log('subscribeRequests: usuário não é admin ou não logado');
    return;
  }

  console.log('Admin UID:', STATE.user.uid);
  const {collection, query, where, onSnapshot} = window.$firebase;
  const q = query(collection(window.$db,'solicitacoes'), where('adminUid','==',STATE.user.uid), where('status','==','pending'));

  STATE.unsubRequests = onSnapshot(q, snap=>{
    console.log('Solicitações pendentes encontradas:', snap.docs.length);
    STATE.requests = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Dados das solicitações:', STATE.requests);

    // Mostrar notificação se houver solicitação
    if(STATE.requests.length > 0 && !currentRequestId){
      console.log('Mostrando modal de solicitação');
      showRequestModal(STATE.requests[0]);
    }

    // Atualizar painel se estiver na aba de motoristas
    if(STATE.adminCurTab==='drivers') renderAdminTab('drivers');
  }, (err)=>{
    console.error('Erro ao escutar solicitações:', err);
    console.error('Código do erro:', err?.code);
    console.error('Mensagem do erro:', err?.message);
  });
  console.log('=== subscribeRequests configurado ===');
}

function showRequestModal(request){
  console.log('=== showRequestModal iniciado ===');
  console.log('Solicitação:', request);
  currentRequestId = request.id;
  const details = document.getElementById('approve-driver-details');
  details.innerHTML = `
    <p style="margin-bottom:8px;"><strong>${request.driverName}</strong> deseja entrar na empresa <strong>${request.empresaNome}</strong>.</p>
    <p style="font-size:13px;color:var(--gray-500);">Ao aprovar, o motorista poderá receber entregas e sua localização será compartilhada em tempo real.</p>
  `;
  openModal('modal-approve-driver');
  console.log('Modal de aprovação aberto');
}

async function approveDriverRequest(){
  console.log('=== approveDriverRequest iniciado ===');
  console.log('Request ID:', currentRequestId);
  if(!currentRequestId || !STATE.user){
    console.error('Request ID ou usuário inválido');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      showToast('⚠️ Firebase não inicializado. Aguarde...');
      return;
    }

    const {doc, updateDoc, serverTimestamp} = window.$firebase;
    const requestRef = doc(window.$db,'solicitacoes', currentRequestId);

    // Buscar solicitação
    console.log('Buscando solicitação...');
    const {getDoc} = window.$firebase;
    const requestSnap = await getDoc(requestRef);
    if(!requestSnap.exists()){
      console.error('Solicitação não encontrada');
      showToast('❌ Solicitação não encontrada');
      return;
    }
    const requestData = requestSnap.data();
    console.log('Dados da solicitação:', requestData);

    // Atualizar status da solicitação
    console.log('Atualizando status da solicitação para approved...');
    await updateDoc(requestRef, {status: 'approved', approvedAt: serverTimestamp()});
    console.log('Status atualizado');

    // Conectar motorista à empresa
    console.log('Conectando motorista à empresa...');
    const driverRef = doc(window.$db,'users', requestData.driverUid);
    await updateDoc(driverRef, {
      empresaId: requestData.empresaId,
      empresaNome: requestData.empresaNome,
      adminUid: STATE.user.uid,
      status: 'ativo',
      connectedAt: serverTimestamp()
    });
    console.log('Motorista conectado à empresa');

    currentRequestId = null;
    closeModal('modal-approve-driver');
    showToast('✅ Motorista aprovado com sucesso!');
    console.log('=== approveDriverRequest concluído com sucesso ===');
    subscribeDrivers();
  } catch(e){
    console.error('Erro ao aprovar motorista:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    showToast('❌ Erro ao aprovar motorista: '+e.message);
  }
}

async function rejectDriverRequest(){
  console.log('=== rejectDriverRequest iniciado ===');
  console.log('Request ID:', currentRequestId);
  if(!currentRequestId){
    console.error('Request ID inválido');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      showToast('⚠️ Firebase não inicializado. Aguarde...');
      return;
    }

    const {doc, updateDoc, serverTimestamp} = window.$firebase;
    const requestRef = doc(window.$db,'solicitacoes', currentRequestId);

    console.log('Atualizando status da solicitação para rejected...');
    await updateDoc(requestRef, {status: 'rejected', rejectedAt: serverTimestamp()});
    console.log('Status atualizado');

    currentRequestId = null;
    closeModal('modal-approve-driver');
    showToast('✅ Solicitação rejeitada.');
    console.log('=== rejectDriverRequest concluído ===');
  } catch(e){
    console.error('Erro ao rejeitar solicitação:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    showToast('❌ Erro ao rejeitar solicitação: '+e.message);
  }
}

async function loadCompanyStatus(){
  console.log('=== loadCompanyStatus iniciado ===');
  if(!STATE.user || STATE.profile?.role !== 'driver'){
    console.log('loadCompanyStatus: usuário não é motorista ou não logado');
    return;
  }

  const container = document.getElementById('company-status');
  if(!container){
    console.error('Container company-status não encontrado');
    return;
  }

  try{
    console.log('Firebase disponível?', !!window.$firebase);
    console.log('Firestore disponível?', !!window.$db);
    if(!window.$firebase || !window.$db){
      console.error('Firebase não inicializado');
      container.innerHTML = `<p style="font-size:13px;color:var(--red);">Erro ao carregar status</p>`;
      return;
    }

    const {collection, query, where, getDocs} = window.$firebase;
    const q = query(collection(window.$db,'solicitacoes'), where('driverUid','==',STATE.user.uid));
    console.log('Buscando solicitações do motorista...');
    const snap = await getDocs(q);
    const requests = snap.docs.map(d=>({id:d.id,...d.data()}));
    console.log('Solicitações encontradas:', requests.length);

    if(STATE.profile?.empresaId){
      console.log('Motorista já conectado à empresa:', STATE.profile.empresaNome);
      container.innerHTML = `<p style="font-size:13px;color:var(--green);">✅ Conectado à: <strong>${STATE.profile.empresaNome}</strong></p>`;
      
      // Mostrar badge na tela principal
      const companyBadge = document.getElementById('d-company-badge');
      const companyNameSpan = document.getElementById('d-company-name');
      if(companyBadge && companyNameSpan){
        companyBadge.style.display = 'inline-flex';
        companyNameSpan.textContent = STATE.profile.empresaNome;
      }
    } else if(requests.length > 0){
      const pending = requests.filter(r=>r.status==='pending');
      console.log('Solicitações pendentes:', pending.length);
      if(pending.length > 0){
        container.innerHTML = `<p style="font-size:13px;color:var(--yellow);">⏳ Aguardando aprovação de: <strong>${pending[0].empresaNome}</strong></p>`;
      } else {
        container.innerHTML = `<p style="font-size:13px;color:var(--red);">❌ Solicitação rejeitada</p>`;
      }
    } else {
      console.log('Nenhuma solicitação encontrada');
      container.innerHTML = `<p style="font-size:13px;color:var(--gray-500);">Nenhuma empresa conectada</p>`;
      
      // Esconder badge na tela principal
      const companyBadge = document.getElementById('d-company-badge');
      if(companyBadge){
        companyBadge.style.display = 'none';
      }
    }
    console.log('=== loadCompanyStatus concluído ===');
  } catch(e){
    console.error('Erro ao carregar status da empresa:', e);
    console.error('Código do erro:', e?.code);
    console.error('Mensagem do erro:', e?.message);
    container.innerHTML = `<p style="font-size:13px;color:var(--red);">Erro ao carregar status</p>`;
  }
}

async function createDriverDelivery(){
  const client = document.getElementById('driver-delivery-client').value.trim();
  const street = document.getElementById('driver-delivery-street').value.trim();
  const number = document.getElementById('driver-delivery-number').value.trim();
  const neighborhood = document.getElementById('driver-delivery-neighborhood').value.trim();
  const city = document.getElementById('driver-delivery-city').value.trim();
  const obs = document.getElementById('driver-delivery-obs').value.trim();
  if(!client || !street){ showToast('⚠️ Preencha nome do cliente e rua'); return; }

  const addr = `${street}, ${number || 'S/N'} - ${neighborhood || ''}, ${city || ''}`;
  try{
    const {collection, addDoc, serverTimestamp} = window.$firebase;
    await addDoc(collection(window.$db,'deliveries'), {
      client: client,
      addr: addr,
      street: street,
      number: number,
      neighborhood: neighborhood,
      city: city,
      obs: obs,
      driverUid: STATE.user.uid,
      driver: STATE.profile?.name || '',
      status: 'pending',
      priority: 'Normal',
      adminCode: STATE.profile?.adminCode || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    document.getElementById('driver-delivery-client').value = '';
    document.getElementById('driver-delivery-street').value = '';
    document.getElementById('driver-delivery-number').value = '';
    document.getElementById('driver-delivery-neighborhood').value = '';
    document.getElementById('driver-delivery-city').value = '';
    document.getElementById('driver-delivery-obs').value = '';
    closeModal('modal-new-delivery');
    showToast('✅ Entrega iniciada com sucesso!');
  } catch(e){
    showToast('❌ Erro ao iniciar entrega: '+e.message);
  }
}

function openStatusModal(id){
  const d = STATE.deliveries.find(x=>x.id===id);
  if(!d) return;
  STATE.selectedDeliveryId = id;
  document.getElementById('s-delivery').value = `${d.client} – ${d.addr}`;
  document.getElementById('s-status').value = d.status;
  openModal('modal-status');
}

async function updateDeliveryStatus(){
  const newStatus = document.getElementById('s-status').value;
  try{
    const {doc, updateDoc, serverTimestamp} = window.$firebase;
    await updateDoc(doc(window.$db,'deliveries',STATE.selectedDeliveryId), {
      status: newStatus, updatedAt: serverTimestamp(),
      ...(newStatus==='done'?{finishedAt:fmtTime()}:{})
    });
    closeModal('modal-status');
    showToast('✅ Status atualizado!');
  } catch(e){
    showToast('❌ Erro: '+e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// LOADING VISUAL
// ─────────────────────────────────────────────────────────────
function showLoading(btn, originalText = null){
  if(!btn) return;
  if(!originalText) originalText = btn.textContent;
  btn.dataset.originalText = originalText;
  btn.disabled = true;
  btn.textContent = '⏳ Carregando...';
  btn.style.opacity = '0.7';
}

function hideLoading(btn){
  if(!btn) return;
  const originalText = btn.dataset.originalText || 'OK';
  btn.disabled = false;
  btn.textContent = originalText;
  btn.style.opacity = '1';
}

// ─────────────────────────────────────────────────────────────
// PROFILE MODAL
// ─────────────────────────────────────────────────────────────
function openModal(id){
  console.log('=== openModal iniciado ===');
  console.log('Modal ID:', id);
  
  if(id==='modal-profile' && STATE.user){
    const p = STATE.profile || {};
    document.getElementById('p-name').textContent  = p.name  || STATE.user.displayName || '–';
    document.getElementById('p-email').textContent = p.email || STATE.user.email       || '–';
    document.getElementById('p-uid').value         = STATE.user.uid;
    document.getElementById('p-avatar').textContent= p.role==='admin' ? '👨‍💼' : '🧑‍✈️';
    document.getElementById('p-role-badge').textContent = p.role==='admin' ? '👨‍💼 Administrador' : '🧑‍✈️ Motorista';
    const companyGroup = document.getElementById('p-company-group');
    const switchGroup = document.getElementById('p-switch-group');
    console.log('Role:', p.role);
    console.log('companyGroup:', !!companyGroup);
    console.log('switchGroup:', !!switchGroup);
    if(companyGroup) companyGroup.style.display = p.role === 'driver' ? 'block' : 'none';
    if(switchGroup) switchGroup.style.display = p.role === 'driver' ? 'block' : 'none';
    console.log('companyGroup display:', companyGroup?.style.display);

    // Carregar status da empresa para motorista
    if(p.role === 'driver'){
      console.log('Carregando status da empresa...');
      loadCompanyStatus();
    }
  }
  if(id==='modal-new'){
    updateDriverSelect();
  }
  
  const modal = document.getElementById(id);
  console.log('Elemento modal encontrado:', !!modal);
  if(modal){
    modal.classList.add('open');
    console.log('Classe "open" adicionada ao modal');
  } else {
    console.error('Modal não encontrado:', id);
  }
  console.log('=== openModal concluído ===');
}
function closeModal(id){ document.getElementById(id)?.classList.remove('open'); }
function closeModalOutside(e, id){ if(e.target.id===id) closeModal(id); }

function switchRole(){
  if(!STATE.user || !STATE.profile){
    showToast('⚠️ Usuário não logado');
    return;
  }
  // Simula troca de papel atualizando o perfil
  const newRole = STATE.profile.role === 'driver' ? 'admin' : 'driver';
  STATE.profile.role = newRole;
  saveProfileToSession(STATE.user.uid, STATE.profile);
  saveRolePreference(newRole);
  closeModal('modal-profile');
  showToast(`✅ Trocado para ${newRole === 'admin' ? 'Administrador' : 'Motorista'}`);
  // Recarrega a interface com o novo papel
  if(newRole === 'admin'){
    enterAdmin();
  } else {
    enterDriver();
  }
}

// ─────────────────────────────────────────────────────────────
// SERVICE WORKER (PWA offline + iPhone)
// ─────────────────────────────────────────────────────────────
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js')
      .then(()=>console.log('✅ SW registrado'))
      .catch(e=>console.warn('SW erro:', e));
  });
}

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 3200);
}

function fmtDate(){
  return new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
}
function fmtTime(){
  return new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function esc(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
