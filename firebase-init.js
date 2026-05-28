import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  doc,
  setDoc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

let firebaseInitTimeout;
let firebaseRetryCount = 0;
const MAX_RETRIES = 2;

async function initFirebase() {
  try {
    if (!firebaseConfig || firebaseConfig.apiKey === 'SUA_API_KEY' || !firebaseConfig.apiKey) {
      throw new Error('Firebase não configurado. Edite firebase-config.js');
    }

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    auth.setPersistence('none'); // Melhora performance, evita problemas de cache
    
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        cacheSizeBytes: 5242880 // 5MB limit - reduzido para mais velocidade
      }),
      cacheTimeoutBytes: 10485760 // 10MB timeout
    });

    window.$auth = auth;
    window.$db = db;
    window.$firebase = {
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      onAuthStateChanged,
      updateProfile,
      sendPasswordResetEmail,
      verifyPasswordResetCode,
      confirmPasswordReset,
      doc,
      setDoc,
      getDoc,
      getDocFromCache,
      getDocFromServer,
      collection,
      addDoc,
      onSnapshot,
      updateDoc,
      serverTimestamp,
      query,
      where,
      orderBy,
      limit,
      getDocs
    };
    window.$firebaseReady = true;
    document.dispatchEvent(new Event("firebase-ready"));
    
    // Limpar timeout
    if (firebaseInitTimeout) {
      clearTimeout(firebaseInitTimeout);
      firebaseInitTimeout = null;
    }
    
  } catch (err) {
    console.error("Firebase init:", err);
    
    // Tentar novamente se for erro de rede
    if (firebaseRetryCount < MAX_RETRIES && (err.code === 'network-error' || err.code === 'unavailable')) {
      firebaseRetryCount++;
      console.log(`Tentando novamente (${firebaseRetryCount}/${MAX_RETRIES})...`);
      firebaseInitTimeout = setTimeout(initFirebase, 2000);
      return;
    }
    
    // Mostrar erro no loading
    const lo = document.getElementById("loading-overlay");
    if (lo) {
      const p = lo.querySelector("p");
      if (p) {
        p.textContent = "Erro: " + (err.message || 'Falha ao conectar Firebase');
        p.style.color = '#ef4444';
      }
      lo.classList.remove("hide");
      lo.style.display = "flex";
      
      // Botão para tentar recarregar
      const btn = document.createElement('button');
      btn.textContent = 'Tentar novamente';
      btn.style.cssText = 'margin-top:16px;padding:12px 24px;background:#1e40af;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;';
      btn.onclick = () => window.location.reload();
      lo.appendChild(btn);
    }
  }
}

// Timeout de segurança: se Firebase demorar mais de 3 segundos, esconde loading
// No celular, usa timeout maior devido a conexão mais lenta
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const firebaseTimeout = isMobile ? 8000 : 3000;
firebaseInitTimeout = setTimeout(() => {
  if (!window.$firebaseReady) {
    console.warn('Firebase init timeout - continuando sem Firebase');
    window.$firebaseReady = false;
    document.dispatchEvent(new Event("firebase-ready"));

    const lo = document.getElementById("loading-overlay");
    if (lo) {
      lo.classList.add('hide');
      setTimeout(() => { lo.style.display = 'none'; }, 120);
    }
  }
}, firebaseTimeout);

// Timeout extra de segurança - garante que loading seja escondido mesmo se Firebase falhar
setTimeout(() => {
  const lo = document.getElementById("loading-overlay");
  if (lo && lo.style.display !== 'none') {
    console.warn('Forçando hide loading - timeout extra');
    lo.classList.add('hide');
    setTimeout(() => { lo.style.display = 'none'; }, 120);
  }
}, firebaseTimeout + 2000);

initFirebase();
