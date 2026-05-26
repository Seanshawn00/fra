// Deshabilitar logs en producci�n
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const debugLog = isProduction ? () => {} : console.log;
const debugError = isProduction ? () => {} : console.error;
const debugWarn = isProduction ? () => {} : console.warn;

debugLog('? script.js starting to load...');

/* =====================================================
   INSTRUMENTOS
   ===================================================== */
const INST = [
  { id: 'pf',     name: 'Plazo Fijo', color: '#4a9eff', defaultTNA: 110, defaultDist: 20, defaultComp: 'mensual', enabled: false },
  { id: 'fci',    name: 'FCI',        color: '#2dd4a0', defaultTNA: 140, defaultDist: 20, defaultComp: 'diario',  enabled: true },
  { id: 'cripto', name: 'Cripto',     color: '#f5a623', defaultTNA: 60,  defaultDist: 10, defaultComp: 'anual', isUSD: true, enabled: false },
  { id: 'cedear', name: 'CEDEARs',    color: '#9d4edd', defaultTNA: 45,  defaultDist: 15, defaultComp: 'anual', isUSD: true, enabled: false },
  { id: 'caucion',name: 'Cauciones',  color: '#ff006e', defaultTNA: 95,  defaultDist: 15, defaultComp: 'diario',  enabled: false },
  { id: 'pfuva',  name: 'Plazo Fijo UVA', color: '#00b4d8', defaultTNA: 85, defaultDist: 10, defaultComp: 'anual', enabled: false },
  { id: 'usd',    name: 'D�lares',    color: '#ffd60a', defaultTNA: 0,   defaultDist: 5,  defaultComp: 'anual', isUSD: true, enabled: false },
  { id: 'bonos',  name: 'Bonos',      color: '#fb5607', defaultTNA: 120, defaultDist: 5,  defaultComp: 'anual', enabled: false },
];

debugLog('? INST array defined:', INST.length, 'items');

let currency = 'ARS';
let chartInstance = null;
let saveTimer = null;
let toastTimer = null;
let aportesCache = [];
let tenenciasCache = [];
let activosCatalogoCache = [];
let patrimonioCache = [];
let negociosEmpresasCache = [];
let negociosVentasCache = [];
let editingActivoCatalogoId = null;
let editingTenenciaId = null;
let editingPatrimonioId = null;
let activeTab = 'simulador';
let planTicker = null;
let tenenciasPieChart = null;
let tenenciasTypeChart = null;
let patrimonioTypeChart = null;
let negociosEmpresaChart = null;

const planState = {
  startedAt: null,
  horizonYears: null,
  capitalProyectadoFijo: null,
  objetivoId: null, // ID del objetivo en DB
  configId: null,   // ID del config en DB
};

const ES_MONTHS_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const MARKET_TNA_COMPARATASAS = {
  fima: 16.58,
  mp: 18.25,
  uala: 20.0,
};

const MOTIVATIONAL_PHRASES = [
  'Cada aporte es un voto por tu libertad futura.',
  'No se trata de velocidad, se trata de constancia.',
  'Tu objetivo crece incluso cuando vos descans�s.',
  'El mejor momento para empezar fue ayer. El segundo mejor es hoy.',
  'Tu yo de ma�ana te agradece cada decisi�n de hoy.',
  'Peque�os montos, gran disciplina, resultados enormes.',
];

/* =====================================================
   REST API (SQLite Backend) + Authentication
   ===================================================== */
// ? DEPRECATED: Using Supabase instead of HTTP API
// const API_URL = 'http://127.0.0.1:3000/api';
// debugLog('? API_URL defined:', API_URL);

// ? NEW: Using Supabase client (initialized in supabase-init.js)
debugLog('? Using Supabase for database operations');

let db = null;
let currentUserId = null;
let currentUsername = null;

// Load session from localStorage
function loadSession() {
  const stored = localStorage.getItem('planRetiroSession');
  if (stored) {
    const { userId, username } = JSON.parse(stored);
    currentUserId = userId;
    currentUsername = username;
    return true;
  }
  return false;
}

// Save session to localStorage
function saveSession(userId, username) {
  currentUserId = userId;
  currentUsername = username;
  localStorage.setItem('planRetiroSession', JSON.stringify({ userId, username }));
}

// Clear session
function clearSession() {
  currentUserId = null;
  currentUsername = null;
  localStorage.removeItem('planRetiroSession');
}

async function openDB() {
  // Check if Supabase is available (v2.0 with Electron)
  try {
    debugLog('?? Esperando Supabase...');
    
    // Opci�n 1: Esperar evento supabaseReady (nuevo m�todo)
    if (!window.supabase) {
      debugLog('?? Escuchando evento supabaseReady...');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout esperando supabaseReady'));
        }, 15000); // 15 segundos
        
        document.addEventListener('supabaseReady', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }
    
    // Opci�n 2: Reintentar si a�n no est� (fallback)
    let attempts = 0;
    while (!window.supabase && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (window.supabase) {
      db = true; // Flag indicating Supabase connection succeeded
      debugLog('? Supabase client inicializado correctamente');
      return db;
    } else {
      throw new Error('Supabase client no se inicializ�');
    }
  } catch (err) {
    debugError('? Error inicializando BD:', err.message);
    throw new Error('Conexi�n fallida: ' + err.message);
  }
}

async function dbPut(tableName, value) {
  try {
    if (!currentUserId) throw new Error('No est�s autenticado');
    if (!window.supabase) throw new Error('Supabase no inicializado');
    
    // A�adir user_id si no existe
    const record = { ...value, user_id: currentUserId };
    
    if (value.id) {
      // Actualizar registro existente
      const { error } = await window.supabase
        .from(tableName)
        .update(record)
        .eq('id', value.id)
        .eq('user_id', currentUserId);
      
      if (error) throw new Error(`UPDATE fallido: ${error.message}`);
      return value.id;
    } else {
      // Crear nuevo registro
      const { data, error } = await window.supabase
        .from(tableName)
        .insert([record])
        .select();
      
      if (error) throw new Error(`INSERT fallido: ${error.message}`);
      return data?.[0]?.id;
    }
  } catch (err) {
    debugError('? dbPut error:', err);
    throw err;
  }
}

async function dbGet(tableName, key) {
  try {
    if (!currentUserId) throw new Error('No est�s autenticado');
    if (!window.supabase) throw new Error('Supabase no inicializado');
    
    const { data, error } = await window.supabase
      .from(tableName)
      .select('*')
      .eq('id', key)
      .eq('user_id', currentUserId)
      .single();
    
    if (error) throw new Error(`GET fallido: ${error.message}`);
    return data;
  } catch (err) {
    debugError('? dbGet error:', err);
    throw err;
  }
}

async function dbGetAll(tableName) {
  try {
    if (!window.supabase) throw new Error('Supabase no inicializado');
    
    // Tablas que son P�BLICAS y no deben filtrar por user_id
    const publicTables = ['activos_catalogo', 'activosCatalogo'];
    const isPublicTable = publicTables.includes(tableName);
    
    let query = window.supabase.from(tableName).select('*');
    
    // Solo filtrar por user_id si NO es una tabla p�blica
    if (!isPublicTable) {
      if (!currentUserId) throw new Error('No est�s autenticado');
      query = query.eq('user_id', currentUserId);
    }
    
    const { data, error } = await query;
    
    if (error) throw new Error(`GET fallido: ${error.message}`);
    
    let results = data || [];
    
    // CASO ESPECIAL: Si es "Shawncita", buscar tambi�n datos bajo "Shawncito" (consolidaci�n temporal)
    // "Shawncita" ID: 3788b6e2-970b-4b15-9d6e-e63610899188
    // "Shawncito" ID: 6b6ecab9-282a-4aa5-a5ad-edbf34772f70
    const shawncitaId = '3788b6e2-970b-4b15-9d6e-e63610899188';
    const shawncitoBkpId = '6b6ecab9-282a-4aa5-a5ad-edbf34772f70';
    
    if (!isPublicTable && currentUserId === shawncitaId) {
      // Buscar datos adicionales bajo el otro ID
      const query2 = window.supabase.from(tableName).select('*').eq('user_id', shawncitoBkpId);
      const { data: data2, error: error2 } = await query2;
      if (!error2 && data2) {
        results = [...results, ...data2];
      }
    }
    
    return results;
  } catch (err) {
    debugError('? dbGetAll error:', err);
    throw err;
  }
}

async function dbDelete(tableName, key) {
  try {
    if (!currentUserId) throw new Error('No est�s autenticado');
    if (!window.supabase) throw new Error('Supabase no inicializado');
    
    const { error } = await window.supabase
      .from(tableName)
      .delete()
      .eq('id', key)
      .eq('user_id', currentUserId);
    
    if (error) throw new Error(`DELETE fallido: ${error.message}`);
    return { success: true };
  } catch (err) {
    debugError('? dbDelete error:', err);
    throw err;
  }
}

// Toggle password visibility
function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const btn = document.getElementById('toggle-password');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '??';
  } else {
    input.type = 'password';
    btn.textContent = '???';
  }
}

// Auth functions
async function loginUser() {
  const usernameInput = (document.getElementById('login-username')?.value || '').trim();
  const password = (document.getElementById('login-password')?.value || '').trim();
  const errorEl = document.getElementById('login-error');

  console.clear();
  debugLog('-'.repeat(60));
  debugLog('?? Intentando login con usuario:', usernameInput);
  debugLog('-'.repeat(60));

  if (!usernameInput || !password) {
    errorEl.textContent = 'Complet� usuario y contrase�a.';
    errorEl.style.display = 'block';
    return;
  }

  try {
    if (!window.supabase) {
      throw new Error('Supabase no inicializado - recarg� la p�gina');
    }
    
    debugLog('?? Buscando usuario en Supabase...');
    debugLog('?? Window.supabase existe:', !!window.supabase);
    debugLog('?? Supabase URL:', window.supabase?.supabaseUrl);
    
    // Primero, traer TODOS los usuarios y buscar localmente
    const { data: allUsers, error: fetchError } = await window.supabase
      .from('users')
      .select('*');
    
    debugLog('?? Respuesta de fetch:', { success: !fetchError, errorMsg: fetchError?.message });
    
    if (fetchError) {
      debugError('? Error al obtener usuarios:', fetchError);
      errorEl.textContent = '? Error de conexi�n: ' + fetchError.message;
      errorEl.style.display = 'block';
      return;
    }

    debugLog('?? Total de usuarios en DB:', allUsers?.length || 0);
    debugLog('?? Usuarios disponibles:', allUsers?.map(u => u.username));
    
    // Buscar usuario: PRIMERO exacta (case-sensitive), luego case-insensitive
    debugLog(`\n?? Buscando "${usernameInput}" (case-sensitive primero)...`);
    let user = allUsers?.find(u => u.username === usernameInput);
    
    if (user) {
      debugLog(`? Encontrado match exacto: "${user.username}"`);
    } else {
      debugLog(`? No hay match exacto. Buscando case-insensitive...`);
      user = allUsers?.find(u => 
        u.username && u.username.toLowerCase() === usernameInput.toLowerCase()
      );
      if (user) {
        debugLog(`? Encontrado match case-insensitive: "${user.username}"`);
      } else {
        debugLog(`? No encontrado en ning�n modo`);
      }
    }
    
    if (!user) {
      debugLog(`\n? USUARIO NO ENCONTRADO: "${usernameInput}"`);
      debugLog('Usuarios en BD:', allUsers?.map(u => u.username));
      errorEl.textContent = 'Usuario o contrase�a incorrectos';
      errorEl.style.display = 'block';
      return;
    }
    
    debugLog(`\n?? Usuario encontrado: "${user.username}" (ID: ${user.id})`);
    debugLog(`?? Verificando contrase�a...`);
    debugLog(`   Input: "${password}"`);
    debugLog(`   BD:    "${user.password}"`);
    debugLog(`   Match: ${user.password === password}`);
    
    
    // Verificar contrase�a (plaintext - considerar bcrypt despu�s)
    if (user.password !== password) {
      debugLog('? CONTRASE�A INCORRECTA');
      errorEl.textContent = 'Usuario o contrase�a incorrectos';
      errorEl.style.display = 'block';
      return;
    }
    
    debugLog('? CONTRASE�A CORRECTA');
    debugLog('? LOGIN EXITOSO PARA:', user.username);
    debugLog('-'.repeat(60) + '\n');
    errorEl.style.display = 'none';
    
    // Login exitoso
    let userIdToUse = user.id;
    
    // CASE ESPECIAL: Shawncito tiene datos bajo ID fijo
    if (user.username === 'Shawncito') {
      userIdToUse = '6b6ecab9-282a-4aa5-a5ad-edbf34772f70';
      debugLog('?? Shawncito: Usando user_id fijo para acceder a sus datos:', userIdToUse);
    }
    
    saveSession(userIdToUse, user.username);
    showApp();
  } catch (err) {
    debugError('? LOGIN ERROR:', err);
    debugError('Stack:', err.stack);
    debugLog('-'.repeat(60) + '\n');
    errorEl.textContent = '? Error: ' + err.message;
    errorEl.style.display = 'block';
  }
}

async function registerUser() {
  const usernameInput = (document.getElementById('login-username')?.value || '').trim();
  const password = (document.getElementById('login-password')?.value || '').trim();
  const errorEl = document.getElementById('login-error');

  debugLog('?? Intentando registrar usuario:', usernameInput);

  if (!usernameInput || !password) {
    errorEl.textContent = 'Complet� usuario y contrase�a.';
    errorEl.style.display = 'block';
    return;
  }

  if (password.length < 4) {
    errorEl.textContent = 'Contrase�a debe tener al menos 4 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  try {
    if (!window.supabase) throw new Error('Supabase no inicializado');
    
    debugLog('?? Verificando si usuario ya existe...');
    
    // Verificar que no exista (case-insensitive)
    const { data: allUsers, error: fetchError } = await window.supabase
      .from('users')
      .select('*');
    
    if (fetchError) {
      throw new Error('Error al verificar usuarios: ' + fetchError.message);
    }

    const userExists = allUsers?.some(u => 
      u.username && u.username.toLowerCase() === usernameInput.toLowerCase()
    );
    
    if (userExists) {
      debugLog('? Usuario ya existe:', usernameInput);
      errorEl.textContent = 'Este usuario ya existe. Intenta con otro nombre.';
      errorEl.style.display = 'block';
      return;
    }

    debugLog('? Usuario disponible, creando...');
    
    // Insertar nuevo usuario
    const { data, error } = await window.supabase
      .from('users')
      .insert([{ username: usernameInput, password }])
      .select();
    
    if (error) {
      debugError('? Error en insert:', error);
      errorEl.textContent = 'Error en registro: ' + error.message;
      errorEl.style.display = 'block';
      return;
    }

    if (!data || data.length === 0) {
      throw new Error('No se retornaron datos del usuario creado');
    }

    debugLog('? Usuario registrado exitosamente:', data[0].username);
    errorEl.style.display = 'none';
    
    // Cargar activos del cat�logo y crear tenencias iniciales
    debugLog('?? Inicializando tenencias del cat�logo...');
    try {
      const { data: catalogo, error: catError } = await window.supabase
        .from('activos_catalogo')
        .select('id');
      
      if (!catError && catalogo && catalogo.length > 0) {
        // Crear tenencia para cada activo del cat�logo
        const tenenciasIniciales = catalogo.map(activo => ({
          user_id: data[0].id,
          activo_id: activo.id,
          cantidad: 0,
          precio_promedio: 0,
          comisiones: 0
        }));
        
        const { error: insertError } = await window.supabase
          .from('tenencias')
          .insert(tenenciasIniciales);
        
        if (insertError) {
          debugWarn('?? Error creando tenencias iniciales:', insertError);
        } else {
          debugLog('? Tenencias iniciales creadas para', catalogo.length, 'activos');
        }
      }
    } catch (err) {
      debugWarn('?? Error inicializando activos:', err.message);
    }
    
    // Registro exitoso - login autom�tico
    saveSession(data[0].id, data[0].username);
    showApp();
  } catch (err) {
    debugError('? Register error:', err);
    errorEl.textContent = 'Error de conexi�n: ' + err.message;
    errorEl.style.display = 'block';
  }
}

function logoutUser() {
  clearSession();
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-container').style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').style.display = 'none';
}

function showApp() {
  // CRITICAL: Clear all caches when user changes
  activosCatalogoCache = [];
  tenenciasCache = [];
  patrimonioCache = [];
  negociosEmpresasCache = [];
  negociosVentasCache = [];
  aportesCache = [];
  
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
  document.getElementById('user-info').textContent = `Conectado como: ${currentUsername}`;
  init();
}

function showLogin() {
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-container').style.display = 'flex';
}

// Toast notifications
function showToast(message, type = 'success') {
  // Remove existing toast if any
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  // Create toast element
  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    z-index: 9999;
    animation: slideIn 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  if (type === 'success') {
    toast.style.background = '#2d3d2d';
    toast.style.color = '#4ade80';
    toast.innerHTML = '? ' + message;
  } else if (type === 'error') {
    toast.style.background = '#3d2d2d';
    toast.style.color = '#ff6b6b';
    toast.innerHTML = '? ' + message;
  } else {
    toast.style.background = '#2d3d4d';
    toast.style.color = '#4a9eff';
    toast.innerHTML = '? ' + message;
  }

  document.body.appendChild(toast);

  // Auto-remove after 2.5 seconds
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* =====================================================
   CONFIG PERSISTENCE
   ===================================================== */
function getConfig() {
  const instruments = {};
  INST.forEach(inst => {
    instruments[inst.id] = {
      tna:  document.getElementById(inst.id + '-tna').value,
      tea:  document.getElementById(inst.id + '-tea').value,
      comp: document.getElementById(inst.id + '-comp').value,
      dist: document.getElementById(inst.id + '-dist').value,
      enabled: inst.enabled,
    };
  });
  return {
    capital:    parseMoneyInputById('capital'),
    aporteMen:  parseMoneyInputById('aporte-men'),
    tcambio:    document.getElementById('tcambio').value,
    horizonte:  document.getElementById('horizonte').value,
    inflacion:  document.getElementById('inflacion').value,
    currency,
    activeTab,
    planState,
    instruments,
  };
}

function applyConfig(cfg) {
  if (!cfg) return;
  setMoneyValue('capital',    cfg.capital,   5000000);
  setMoneyValue('aporte-men', cfg.aporteMen, 200000);
  setValue('tcambio',    cfg.tcambio,   1200);

  if (cfg.horizonte !== undefined) {
    document.getElementById('horizonte').value = cfg.horizonte;
    document.getElementById('hor-val').textContent = cfg.horizonte + ' a�os';
  }
  if (cfg.inflacion !== undefined) {
    document.getElementById('inflacion').value = cfg.inflacion;
    document.getElementById('inf-val').textContent = cfg.inflacion + '%';
  }
  if (cfg.currency) {
    currency = cfg.currency;
    document.getElementById('btn-ars').classList.toggle('active', currency === 'ARS');
    document.getElementById('btn-usd').classList.toggle('active', currency === 'USD');
    document.getElementById('m-currency-label').textContent = 'en ' + currency + ' al final del horizonte';
  }
  if (cfg.activeTab) {
    activeTab = cfg.activeTab;
  }
  if (cfg.planState) {
    planState.startedAt = cfg.planState.startedAt || null;
    planState.horizonYears = cfg.planState.horizonYears || null;
  }
  if (cfg.instruments) {
    INST.forEach(inst => {
      const ic = cfg.instruments[inst.id];
      if (!ic) return;
      if (ic.enabled !== undefined) inst.enabled = ic.enabled;
      if (ic.comp !== undefined) document.getElementById(inst.id + '-comp').value = ic.comp;
      if (ic.tna  !== undefined) document.getElementById(inst.id + '-tna').value  = ic.tna;
      if (ic.dist !== undefined) document.getElementById(inst.id + '-dist').value = ic.dist;
      // recalculate TEA from saved TNA
      const tnaVal  = parseFloat(ic.tna) || 0;
      const compVal = ic.comp || 'mensual';
      const teaVal  = tnaToTea(tnaVal, compVal);
      document.getElementById(inst.id + '-tea').value = teaVal.toFixed(2);
    });
  }
}

function setValue(id, val, fallback) {
  const el = document.getElementById(id);
  if (el) el.value = (val !== undefined && val !== '') ? val : fallback;
}

function setTab(tab, persist = true) {
  activeTab = tab;
  document.getElementById('tab-btn-simulador').classList.toggle('active', tab === 'simulador');
  document.getElementById('tab-btn-objetivo').classList.toggle('active', tab === 'objetivo');
  document.getElementById('tab-btn-tenencias').classList.toggle('active', tab === 'tenencias');
  document.getElementById('tab-btn-bbdd').classList.toggle('active', tab === 'bbdd');
  document.getElementById('tab-btn-patrimonio').classList.toggle('active', tab === 'patrimonio');
  document.getElementById('tab-btn-negocios').classList.toggle('active', tab === 'negocios');
  document.getElementById('tab-simulador').classList.toggle('active', tab === 'simulador');
  document.getElementById('tab-objetivo').classList.toggle('active', tab === 'objetivo');
  document.getElementById('tab-tenencias').classList.toggle('active', tab === 'tenencias');
  document.getElementById('tab-bbdd').classList.toggle('active', tab === 'bbdd');
  document.getElementById('tab-patrimonio').classList.toggle('active', tab === 'patrimonio');
  document.getElementById('tab-negocios').classList.toggle('active', tab === 'negocios');
  if (tab === 'objetivo') {
    showMotivationalPhrase();
  }
  if (persist) saveConfigDB();
}

function showMotivationalPhrase() {
  const quote = MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)];
  document.getElementById('motivation-quote').textContent = quote;
}

function isPlanInputReady() {
  return parseMoneyInputById('capital') > 0
    && parseMoneyInputById('aporte-men') > 0
    && (parseInt(document.getElementById('horizonte').value, 10) || 0) > 0;
}

async function startObjectivePlan() {
  if (!isPlanInputReady()) {
    alert('Complet� capital inicial, aporte mensual y horizonte antes de iniciar el objetivo.');
    return;
  }
  planState.startedAt = new Date().toISOString();
  planState.horizonYears = parseInt(document.getElementById('horizonte').value, 10) || 1;
  planState.capitalProyectadoFijo = getCapitalProjectado(); // Congelar capital proyectado
  await saveObjetivoToDB(); // Esperar a que se guarde el objetivo
  setTab('objetivo', false); // false = no llamar a saveConfigDB() ac�
  updateObjectiveView();
}

function resetObjectivePlan() {
  if (!confirm('�Quer�s reiniciar el objetivo en curso? El simulador no se borra.')) return;
  planState.startedAt = null;
  planState.horizonYears = null;
  planState.capitalProyectadoFijo = null; // Descongelar capital proyectado
  planState.objetivoId = null; // Limpiar ID
  saveConfigDB();
  saveObjetivoToDB();
  updateObjectiveView();
}

/* =====================================================
   OBJETIVO PLAN - DATABASE FUNCTIONS
   ===================================================== */
function getCapitalProjectado() {
  // Retorna el valor de m-final (capital proyectado del simulador)
  const val = document.getElementById('m-final');
  if (!val) return 0;
  const txt = val.textContent.replace(/\D/g, '');
  return txt ? parseInt(txt, 10) : 0;
}

function getCapitalAcumulado() {
  // Suma tenencias + aportes reales
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  const { arsEq } = getTenenciasTotals();
  const aportesTotal = getAportesTotalARS();
  return arsEq + aportesTotal;
}

async function saveObjetivoToDB() {
  if (!currentUserId || !window.supabase) return;
  try {
    const objetivo = {
      id: planState.objetivoId || undefined, // Usar ID guardado si existe
      startedAt: planState.startedAt || null,
      horizonYears: planState.horizonYears || null,
      capitalInicial: parseMoneyInputById('capital'),
      capitalProjectado: planState.capitalProyectadoFijo || getCapitalProjectado(),
      capitalAcumulado: getCapitalAcumulado(),
      detalles: document.getElementById('objetivo-detalles')?.value || '',
      estado: planState.startedAt ? 'activo' : 'inactivo',
      timestamp: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Si hay objetivo activo, guardar en DB
    if (planState.startedAt) {
      const savedId = await dbPut('objetivos', objetivo);
      planState.objetivoId = savedId; // Guardar el ID para pr�ximas actualizaciones
    }
  } catch (err) {
    debugError('Error saving objetivo:', err);
  }
}

async function loadObjetivoFromDB() {
  if (!currentUserId || !db) return;
  try {
    const rows = await dbGetAll('objetivos');
    if (rows && rows.length > 0) {
      const objetivo = rows[0]; // Asumir que hay solo uno activo
      planState.objetivoId = objetivo.id; // Guardar el ID para futuras actualizaciones
      if (objetivo.startedAt) {
        planState.startedAt = objetivo.startedAt;
        planState.horizonYears = objetivo.horizonYears;
        planState.capitalProyectadoFijo = objetivo.capitalProjectado; // Cargar capital congelado
        if (document.getElementById('objetivo-detalles')) {
          document.getElementById('objetivo-detalles').value = objetivo.detalles || '';
        }
      }
    }
  } catch (err) {
    debugError('Error loading objetivo:', err);
  }
}

function formatDateTime(dt) {
  return dt.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function calcRemainingYMDHMS(now, end) {
  if (now >= end) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  }

  const ref = new Date(now);
  let years = 0;
  while (true) {
    const t = new Date(ref);
    t.setFullYear(t.getFullYear() + 1);
    if (t <= end) {
      years += 1;
      ref.setFullYear(ref.getFullYear() + 1);
    } else break;
  }

  let months = 0;
  while (true) {
    const t = new Date(ref);
    t.setMonth(t.getMonth() + 1);
    if (t <= end) {
      months += 1;
      ref.setMonth(ref.getMonth() + 1);
    } else break;
  }

  let remainingMs = end - ref;
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  const secondMs = 1000;
  const days = Math.floor(remainingMs / dayMs);
  remainingMs -= days * dayMs;
  const hours = Math.floor(remainingMs / hourMs);
  remainingMs -= hours * hourMs;
  const minutes = Math.floor(remainingMs / minuteMs);
  remainingMs -= minutes * minuteMs;
  const seconds = Math.floor(remainingMs / secondMs);

  return { years, months, days, hours, minutes, seconds, done: false };
}

function getAportesTotalARS() {
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  return aportesCache.reduce((sum, ap) => sum + toARS(Number(ap.monto) || 0, ap.moneda, tc), 0);
}

function getTenenciasTotals() {
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  let arsNominal = 0;
  let usdNominal = 0;
  let arsEq = 0;

  tenenciasCache.forEach(t => {
    const cantidad = Number(t.cantidad) || 0;
    const precio = Number(t.precio_unitario) || 0;
    const total = cantidad * precio;
    if (t.moneda === 'USD') {
      usdNominal += total;
      arsEq += total * tc;
    } else {
      arsNominal += total;
      arsEq += total;
    }
  });

  return { arsNominal, usdNominal, arsEq };
}

function updateMonthlyGoalProgress() {
  const goal = parseMoneyInputById('aporte-men');
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  const now = new Date();
  const currentMonthAportes = aportesCache
    .filter(ap => {
      const d = new Date(ap.fecha + 'T00:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((sum, ap) => sum + toARS(Number(ap.monto) || 0, ap.moneda, tc), 0);

  const pct = goal > 0 ? (currentMonthAportes / goal) * 100 : 0;
  const pctDisplay = Math.max(0, Math.round(pct));
  const pctWidth = Math.min(100, Math.max(0, pct));

  document.getElementById('month-progress-pct').textContent = pctDisplay + '%';
  document.getElementById('month-progress-fill').style.width = pctWidth + '%';

  if (goal <= 0) {
    document.getElementById('month-progress-note').textContent = 'Defin� un aporte mensual para activar el objetivo del mes.';
    return;
  }

  const faltante = Math.max(0, goal - currentMonthAportes);
  if (currentMonthAportes >= goal) {
    document.getElementById('month-progress-note').textContent = 'Objetivo mensual cumplido. Excelente disciplina.';
  } else {
    document.getElementById('month-progress-note').textContent = 'Te faltan ' + fmtARS(faltante) + ' para completar este mes.';
  }

  const horizon = parseInt(document.getElementById('horizonte').value, 10) || 1;
  const targetTotal = parseMoneyInputById('capital') + parseMoneyInputById('aporte-men') * 12 * horizon;
  const wealthNow = parseMoneyInputById('capital') + getAportesTotalARS() + getTenenciasTotals().arsEq;
  const totalPct = targetTotal > 0 ? (wealthNow / targetTotal) * 100 : 0;
  const totalPctDisplay = Math.max(0, Math.round(totalPct));
  const totalPctWidth = Math.min(100, Math.max(0, totalPct));

  document.getElementById('total-progress-pct').textContent = totalPctDisplay + '%';
  document.getElementById('total-progress-fill').style.width = totalPctWidth + '%';

  if (targetTotal <= 0) {
    document.getElementById('total-progress-note').textContent = 'Defin� capital y aportes para medir el objetivo total.';
  } else if (wealthNow >= targetTotal) {
    document.getElementById('total-progress-note').textContent = 'Objetivo financiero nominal alcanzado considerando aportes y tenencias.';
  } else {
    document.getElementById('total-progress-note').textContent = 'Te faltan ' + fmtARS(targetTotal - wealthNow) + ' para tu objetivo nominal.';
  }
}

function updateObjectiveView() {
  const startBtn = document.getElementById('btn-start-plan');
  startBtn.disabled = !isPlanInputReady();
  startBtn.style.opacity = startBtn.disabled ? '0.6' : '1';

  // Actualizar capital proyectado y acumulado
  // Si el objetivo est� activo, usar el capital congelado; si no, usar el actual del simulador
  const capitalProyectado = planState.startedAt ? (planState.capitalProyectadoFijo || getCapitalProjectado()) : getCapitalProjectado();
  const capitalAcumulado = getCapitalAcumulado();
  
  const elProyectado = document.getElementById('objetivo-capital-proyectado');
  const elAcumulado = document.getElementById('objetivo-capital-acumulado');
  
  if (elProyectado) {
    elProyectado.textContent = capitalProyectado > 0 ? fmtARS(capitalProyectado) : '$ 0';
  }
  if (elAcumulado) {
    elAcumulado.textContent = capitalAcumulado > 0 ? fmtARS(capitalAcumulado) : '$ 0';
  }

  const status = document.getElementById('objective-status');
  if (!planState.startedAt || !planState.horizonYears) {
    document.getElementById('count-years').textContent = '0';
    document.getElementById('count-months').textContent = '0';
    document.getElementById('count-days').textContent = '0';
    document.getElementById('count-hours').textContent = '0';
    document.getElementById('count-minutes').textContent = '0';
    document.getElementById('count-seconds').textContent = '0';
    status.textContent = 'Esperando inicio del objetivo. Presion� "Iniciar mi objetivo".';
    updateMonthlyGoalProgress();
    return;
  }

  const startedAt = new Date(planState.startedAt);
  const endAt = new Date(startedAt);
  endAt.setFullYear(endAt.getFullYear() + Number(planState.horizonYears));
  const rem = calcRemainingYMDHMS(new Date(), endAt);

  document.getElementById('count-years').textContent = String(rem.years);
  document.getElementById('count-months').textContent = String(rem.months);
  document.getElementById('count-days').textContent = String(rem.days);
  document.getElementById('count-hours').textContent = String(rem.hours);
  document.getElementById('count-minutes').textContent = String(rem.minutes);
  document.getElementById('count-seconds').textContent = String(rem.seconds);

  // Verificar si se alcanz� la meta de capital
  const capitalProyectadoMeta = planState.capitalProyectadoFijo || getCapitalProjectado();
  const capitalAcumuladoActual = getCapitalAcumulado();
  const metaAlcanzada = capitalAcumuladoActual >= capitalProyectadoMeta;

  if (rem.done) {
    status.textContent = '?? �Objetivo alcanzado! Cumpliste el horizonte del plan.';
  } else if (metaAlcanzada) {
    status.textContent = '?? �Felicitaciones! Alcanzaste tu meta de capital proyectado.';
  } else {
    status.textContent = 'Iniciado el ' + formatDateTime(startedAt) + ' � Meta: ' + formatDateTime(endAt);
  }

  updateMonthlyGoalProgress();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatMoneyWithDots(value) {
  const digits = onlyDigits(value);
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString('es-AR');
}

function parseMoneyInputById(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const digits = onlyDigits(el.value);
  return digits ? parseInt(digits, 10) : 0;
}

function formatMoneyField(input) {
  input.value = formatMoneyWithDots(input.value);
}

function setMoneyValue(id, val, fallback) {
  const el = document.getElementById(id);
  const source = (val !== undefined && val !== '') ? val : fallback;
  if (el) el.value = formatMoneyWithDots(source);
}

function saveConfigDB() {
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!db || !currentUserId) return;
    try {
      const configData = getConfig();
      
      // Generar UUID si es la primera vez
      if (!planState.configId) {
        planState.configId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
      
      await dbPut('config', {
        id: planState.configId,
        value: JSON.stringify(configData)
      });
      setSaveStatus('saved');
    } catch (e) {
      debugError('Config save error:', e);
      setSaveStatus('error');
    }
  }, 600);
}

function setSaveStatus(state) {
  const el    = document.getElementById('save-indicator');
  const label = document.getElementById('save-label');
  el.className = 'save-indicator';
  if (state === 'saved') {
    el.classList.add('saved');
    label.textContent = 'guardado';
    setTimeout(() => {
      if (el.classList.contains('saved')) {
        el.classList.remove('saved');
        label.textContent = 'sin cambios';
      }
    }, 2500);
  } else if (state === 'saving') {
    label.textContent = 'guardando�';
  } else {
    label.textContent = 'error al guardar';
  }
}

async function confirmReset() {
  if (!confirm('�Reiniciar toda la configuraci�n a los valores por defecto? Esto NO borrar� el historial de aportes.')) return;
  if (db) await dbDelete('config', 'main');
  location.reload();
}

/* =====================================================
   TNA ? TEA CONVERSIONES
   ===================================================== */
function tnaToTea(tna, comp) {
  const r = tna / 100;
  if (comp === 'diario')  return (Math.pow(1 + r / 365, 365) - 1) * 100;
  if (comp === 'mensual') return (Math.pow(1 + r / 12,  12)  - 1) * 100;
  return r * 100; // anual
}

function teaToTna(tea, comp) {
  const r = tea / 100;
  if (comp === 'diario')  return (Math.pow(1 + r, 1 / 365) - 1) * 365 * 100;
  if (comp === 'mensual') return (Math.pow(1 + r, 1 / 12)  - 1) * 12  * 100;
  return r * 100; // anual, TNA = TEA
}

// Called when TNA input changes ? update TEA
function updateTEAFromTNA(id) {
  const tna  = parseFloat(document.getElementById(id + '-tna').value) || 0;
  const comp = document.getElementById(id + '-comp').value;
  const tea  = tnaToTea(tna, comp);
  const teaEl = document.getElementById(id + '-tea');
  // avoid feedback loop
  teaEl.dataset.updating = '1';
  teaEl.value = tea.toFixed(2);
  delete teaEl.dataset.updating;
}

// Called when TEA input changes ? update TNA
function updateTNAFromTEA(id) {
  const teaEl = document.getElementById(id + '-tea');
  if (teaEl.dataset.updating) return;
  const tea  = parseFloat(teaEl.value) || 0;
  const comp = document.getElementById(id + '-comp').value;
  const tna  = teaToTna(tea, comp);
  const tnaEl = document.getElementById(id + '-tna');
  tnaEl.dataset.updating = '1';
  tnaEl.value = tna.toFixed(2);
  delete tnaEl.dataset.updating;
}

// Called when capitalizaci�n changes ? re-derive TEA from current TNA
function updateOnCompChange(id) {
  updateTEAFromTNA(id);
}

/* =====================================================
   BUILD INSTRUMENT CARDS
   ===================================================== */
function buildInstruments() {
  const grid = document.getElementById('inst-grid');
  grid.innerHTML = '';
  INST.forEach(inst => {
    const initialTEA = tnaToTea(inst.defaultTNA, inst.defaultComp);
    const div = document.createElement('div');
    div.className = 'inst-card';
    div.style.opacity = inst.enabled ? '1' : '0.5';
    div.innerHTML = `
      <div class="inst-header">
        <div class="inst-color-bar" style="background:${inst.color}"></div>
        <div class="inst-name">${inst.name}</div>
        ${inst.isUSD ? '<span class="inst-badge">USD</span>' : ''}
        <button class="inst-toggle" id="${inst.id}-toggle" onclick="toggleInstrument('${inst.id}')" style="margin-left:auto; padding:4px 8px; border:1px solid var(--border); border-radius:4px; background:${inst.enabled ? '#4ade80' : '#666'}; color:white; cursor:pointer; font-size:11px; font-weight:bold;">
          ${inst.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div class="rate-sync-badge">TNA ? TEA <span>sincronizados</span></div>
      <div class="field-row">
        <div class="field">
          <label>TNA (%)</label>
          <input type="number" id="${inst.id}-tna" value="${inst.defaultTNA}" step="0.1" min="0" max="5000"
            oninput="updateTEAFromTNA('${inst.id}'); saveConfigDB(); recalc();" ${!inst.enabled ? 'disabled' : ''} />
        </div>
        <div class="field">
          <label>TEA (%)</label>
          <input type="number" id="${inst.id}-tea" value="${initialTEA.toFixed(2)}" step="0.1" min="0" max="100000"
            oninput="updateTNAFromTEA('${inst.id}'); saveConfigDB(); recalc();" ${!inst.enabled ? 'disabled' : ''} />
        </div>
      </div>
      <div class="field">
        <label>Capitalizaci�n</label>
        <select id="${inst.id}-comp"
          onchange="updateOnCompChange('${inst.id}'); saveConfigDB(); recalc();" ${!inst.enabled ? 'disabled' : ''}>
          <option value="diario"  ${inst.defaultComp==='diario' ?'selected':''}>Diaria (365)</option>
          <option value="mensual" ${inst.defaultComp==='mensual'?'selected':''}>Mensual (12)</option>
          <option value="anual"   ${inst.defaultComp==='anual'  ?'selected':''}>Anual (1)</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Distribuci�n (%)</label>
        <input type="number" id="${inst.id}-dist" value="${inst.defaultDist}" step="5" min="0" max="100"
          oninput="checkDist(); saveConfigDB(); recalc();" ${!inst.enabled ? 'disabled' : ''} />
      </div>`;
    grid.appendChild(div);
  });
}

function toggleInstrument(instId) {
  const inst = INST.find(i => i.id === instId);
  if (!inst) return;
  
  inst.enabled = !inst.enabled;
  
  // Redistribute
  redistributeDist(instId);
  
  // Rebuild UI
  buildInstruments();
  saveConfigDB();
  recalc();
}

/* =====================================================
   APORTES REALES (HISTORIAL)
   ===================================================== */
function formatMontoInput(input) {
  // Remove all non-digit characters
  let value = input.value.replace(/\D/g, '');
  
  // Format with dots as thousand separators
  if (value) {
    value = value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  
  input.value = value;
}

function initAporteFecha() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('aporte-fecha').value = today;
}

async function registrarAporte() {
  try {
    const fecha  = document.getElementById('aporte-fecha').value;
    const montoStr = document.getElementById('aporte-monto-input').value.replace(/\./g, ''); // Remove formatting dots
    const monto  = parseFloat(montoStr);
    const moneda = document.getElementById('aporte-moneda-sel').value;
    const validEl = document.getElementById('aporte-validation');

    if (!fecha || !monto || monto <= 0) {
      validEl.style.display = 'block';
      return;
    }
    validEl.style.display = 'none';

    const aporte = { fecha, monto, moneda, timestamp: Date.now() };
    await dbPut('aportes', aporte);
    showToast('? Aporte guardado exitosamente');

    // reset form
    document.getElementById('aporte-monto-input').value = '';
    initAporteFecha();

    await renderAportesTable();
    recalc();
  } catch (err) {
    debugError('Error registrando aporte:', err);
    showToast(`? Error: ${err.message}`, 'error');
  }
}

async function eliminarAporte(id) {
  if (!confirm('�Eliminar este aporte?')) return;
  await dbDelete('aportes', id);
  showToast('Aporte eliminado');
  await renderAportesTable();
  recalc();
}

async function renderAportesTable() {
  if (!db) return;
  const all = await dbGetAll('aportes');
  all.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  aportesCache = all;

  const tc        = parseFloat(document.getElementById('tcambio').value) || 1200;
  const emptyEl   = document.getElementById('aportes-empty');
  const tableWrap = document.getElementById('aportes-table-wrap');
  const summaryEl = document.getElementById('aportes-summary');
  const tbody     = document.getElementById('aportes-tbody');
  const tfoot     = document.getElementById('aportes-tfoot');

  if (all.length === 0) {
    emptyEl.style.display   = 'block';
    tableWrap.style.display = 'none';
    summaryEl.style.display = 'none';
    return;
  }

  emptyEl.style.display   = 'none';
  tableWrap.style.display = 'block';
  summaryEl.style.display = 'grid';

  let totalARS = 0, totalUSD = 0;
  tbody.innerHTML = '';

  all.forEach(ap => {
    const eqARS = ap.moneda === 'ARS' ? ap.monto : ap.monto * tc;
    if (ap.moneda === 'ARS') totalARS += ap.monto;
    else totalUSD += ap.monto;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatFecha(ap.fecha)}</td>
      <td style="text-align:center;">
        <span class="aporte-moneda-badge ${ap.moneda === 'ARS' ? 'badge-ars' : 'badge-usd'}">${ap.moneda}</span>
      </td>
      <td>${ap.moneda === 'ARS' ? '$ ' : 'US$ '}${ap.monto.toLocaleString('es-AR')}</td>
      <td>$ ${Math.round(eqARS).toLocaleString('es-AR')}</td>
      <td style="text-align:center;">
        <button class="btn-icon" onclick="eliminarAporte(${ap.id})">?</button>
      </td>`;
    tbody.appendChild(tr);
  });

  // Footer totals
  const totalEqARS = totalARS + totalUSD * tc;
  tfoot.innerHTML = `
    <tr>
      <td style="font-weight:600; color:var(--text);">Total</td>
      <td></td>
      <td></td>
      <td class="total-col" style="font-weight:600;">$ ${Math.round(totalEqARS).toLocaleString('es-AR')}</td>
      <td></td>
    </tr>`;

  // Summary stats
  document.getElementById('stat-total-ars').textContent = '$ ' + Math.round(totalARS).toLocaleString('es-AR');
  document.getElementById('stat-total-usd').textContent = 'US$ ' + Math.round(totalUSD).toLocaleString('es-AR');
  document.getElementById('stat-count').textContent     = all.length;
}

function formatFecha(isoDate) {
  if (!isoDate) return '�';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function formatTimestamp(ts) {
  if (!ts) return '�';
  
  // Si es un string ISO (Supabase format)
  if (typeof ts === 'string') {
    const date = new Date(ts);
    if (!isNaN(date.getTime())) {
      return date.toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return '�';
  }
  
  // Si es un n�mero (timestamp en milisegundos)
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '�';
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toARS(monto, moneda, tc) {
  return moneda === 'USD' ? (monto * tc) : monto;
}

async function loadTenenciasCache() {
  if (!db) return;
  try {
    const all = await dbGetAll('tenencias');
    debugLog('tenencias loaded:', all.length, 'items');
    all.sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
    tenenciasCache = all;
  } catch (e) {
    debugError('Error loading tenencias:', e);
  }
}

async function loadActivosCatalogoCache() {
  if (!db) {
    debugWarn('DB not initialized');
    return;
  }
  try {
    const all = await dbGetAll('activos_catalogo');
    debugLog('activos_catalogo loaded:', all.length, 'items');
    all.sort((a, b) => String(a.simbolo || '').localeCompare(String(b.simbolo || '')));
    activosCatalogoCache = all;
  } catch (e) {
    debugError('Error loading activos_catalogo:', e);
  }
}

function onTenenciaSearchInput() {
  const searchInput = document.getElementById('tenencia-activo-search');
  const dropdown = document.getElementById('tenencia-activo-dropdown');
  const query = (searchInput.value || '').toLowerCase().trim();

  if (!query) {
    dropdown.style.display = 'none';
    return;
  }

  const filtered = activosCatalogoCache.filter(a => {
    const simbolo = (a.simbolo || '').toLowerCase();
    const nombre = (a.nombre || '').toLowerCase();
    return simbolo.includes(query) || nombre.includes(query);
  });

  dropdown.innerHTML = '';
  filtered.forEach(a => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 12px; border-bottom:1px solid #333; cursor:pointer; font-size:12px; color:#ccc; font-family:"DM Mono"; transition:background 0.15s;';
    div.textContent = `${a.simbolo} � ${a.nombre}`;
    div.onmouseover = () => div.style.background = '#2a2a2a';
    div.onmouseout = () => div.style.background = '';
    div.onclick = () => {
      selectTenenciaActivo(a);
    };
    dropdown.appendChild(div);
  });

  dropdown.style.display = filtered.length > 0 ? 'block' : 'none';
}

function selectTenenciaActivo(activo) {
  document.getElementById('tenencia-activo').value = String(activo.id);
  document.getElementById('tenencia-activo-search').value = `${activo.simbolo} � ${activo.nombre}`;
  document.getElementById('tenencia-activo-dropdown').style.display = 'none';
  onTenenciaActivoChange();
}

function renderActivoSelector() {
  // Now just populate search, not a select
  const searchInput = document.getElementById('tenencia-activo-search');
  if (searchInput) {
    searchInput.value = '';
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tenencia-activo-search') && !e.target.closest('#tenencia-activo-dropdown')) {
    document.getElementById('tenencia-activo-dropdown').style.display = 'none';
  }
});

function renderBbddTable() {
  const empty = document.getElementById('bbdd-empty');
  const wrap = document.getElementById('bbdd-wrap');
  const body = document.getElementById('bbdd-body');

  body.innerHTML = '';
  if (activosCatalogoCache.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  wrap.style.display = 'block';

  activosCatalogoCache.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${a.simbolo || '�'}</td>
      <td>${a.nombre || '�'}</td>
      <td>${String(a.tipo || '').toUpperCase()}</td>
      <td>${a.moneda || 'ARS'}</td>
      <td>${a.plataforma || '�'}</td>
      <td style="text-align:center;">
        <button class="btn-icon" onclick="iniciarEdicionActivoCatalogo(${a.id})">?</button>
        <button class="btn-icon" onclick="eliminarActivoCatalogo(${a.id})">?</button>
      </td>`;
    body.appendChild(tr);
  });
}

function limpiarBbddForm() {
  document.getElementById('bbdd-simbolo').value = '';
  document.getElementById('bbdd-nombre').value = '';
  document.getElementById('bbdd-tipo').value = 'cripto';
  document.getElementById('bbdd-moneda').value = 'ARS';
  document.getElementById('bbdd-plataforma').value = '';
}

function updateBbddEditState() {
  const saveBtn = document.getElementById('bbdd-save-btn');
  const cancelBtn = document.getElementById('bbdd-cancel-btn');
  const status = document.getElementById('bbdd-edit-status');

  if (editingActivoCatalogoId) {
    saveBtn.textContent = 'Guardar cambios';
    cancelBtn.style.display = 'inline-flex';
    const activo = activosCatalogoCache.find(a => a.id === editingActivoCatalogoId);
    status.style.display = 'block';
    status.textContent = 'Editando activo: ' + ((activo && activo.simbolo) || '');
  } else {
    saveBtn.textContent = '+ Guardar activo';
    cancelBtn.style.display = 'none';
    status.style.display = 'none';
    status.textContent = '';
  }
}

function iniciarEdicionActivoCatalogo(id) {
  const activo = activosCatalogoCache.find(a => a.id === id);
  if (!activo) return;

  editingActivoCatalogoId = id;
  document.getElementById('bbdd-simbolo').value = activo.simbolo || '';
  document.getElementById('bbdd-nombre').value = activo.nombre || '';
  document.getElementById('bbdd-tipo').value = activo.tipo || 'otro';
  document.getElementById('bbdd-moneda').value = activo.moneda || 'ARS';
  document.getElementById('bbdd-plataforma').value = activo.plataforma || '';
  document.getElementById('bbdd-validation').style.display = 'none';
  updateBbddEditState();
}

function cancelarEdicionActivoCatalogo() {
  editingActivoCatalogoId = null;
  limpiarBbddForm();
  document.getElementById('bbdd-validation').style.display = 'none';
  updateBbddEditState();
}

function onTenenciaActivoChange() {
  const id = parseInt(document.getElementById('tenencia-activo').value, 10);
  if (!id) return;
  const activo = activosCatalogoCache.find(a => a.id === id);
  if (!activo) return;

  const platInput = document.getElementById('tenencia-plataforma');
  if (!platInput.value && activo.plataforma) {
    platInput.value = activo.plataforma;
  }
}

async function registrarActivoCatalogo() {
  const simbolo = (document.getElementById('bbdd-simbolo').value || '').trim().toUpperCase();
  const nombre = (document.getElementById('bbdd-nombre').value || '').trim();
  const tipo = document.getElementById('bbdd-tipo').value;
  const moneda = document.getElementById('bbdd-moneda').value;
  const plataforma = (document.getElementById('bbdd-plataforma').value || '').trim();
  const validEl = document.getElementById('bbdd-validation');

  if (!simbolo || !nombre) {
    validEl.style.display = 'block';
    return;
  }
  validEl.style.display = 'none';

  const basePayload = {
    simbolo,
    nombre,
    tipo,
    moneda,
    plataforma,
  };

  if (editingActivoCatalogoId) {
    const current = activosCatalogoCache.find(a => a.id === editingActivoCatalogoId);
    await dbPut('activos_catalogo', {
      ...basePayload,
      id: editingActivoCatalogoId,
      timestamp: current?.timestamp || Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Activo actualizado');
  } else {
    await dbPut('activos_catalogo', {
      ...basePayload,
      timestamp: Date.now(),
    });
    showToast('Activo agregado a la BD');
  }

  await loadActivosCatalogoCache();
  renderBbddTable();
  renderActivoSelector();
  renderTenenciasTables();
  cancelarEdicionActivoCatalogo();
}

async function eliminarActivoCatalogo(id) {
  if (!confirm('�Eliminar este activo del cat�logo?')) return;
  await dbDelete('activos_catalogo', id);
  showToast('Activo eliminado de la BD');
  await loadActivosCatalogoCache();
  renderBbddTable();
  renderActivoSelector();

  if (editingActivoCatalogoId === id) {
    cancelarEdicionActivoCatalogo();
  }
  if (editingPatrimonioId === id) {
    cancelarEdicionPatrimonio();
  }
}

function fmtTenenciaTotal(moneda, total) {
  if (moneda === 'USD') {
    return 'US$ ' + total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '$ ' + Math.round(total).toLocaleString('es-AR');
}

function limpiarTenenciaForm() {
  document.getElementById('tenencia-activo').value = '';
  document.getElementById('tenencia-plataforma').value = '';
  document.getElementById('tenencia-cantidad').value = '';
  document.getElementById('tenencia-precio').value = '';
}

function updateTenenciaEditState() {
  const saveBtn = document.getElementById('tenencia-save-btn');
  const cancelBtn = document.getElementById('tenencia-cancel-btn');
  const status = document.getElementById('tenencia-edit-status');

  if (editingTenenciaId) {
    saveBtn.textContent = 'Guardar cambios';
    cancelBtn.style.display = 'inline-flex';
    const ten = tenenciasCache.find(t => t.id === editingTenenciaId);
    status.style.display = 'block';
    status.textContent = 'Editando tenencia: ' + (ten?.activo || '');
  } else {
    saveBtn.textContent = '+ Agregar';
    cancelBtn.style.display = 'none';
    status.style.display = 'none';
    status.textContent = '';
  }
}

function iniciarEdicionTenencia(id) {
  const ten = tenenciasCache.find(t => t.id === id);
  if (!ten) return;

  editingTenenciaId = id;
  document.getElementById('tenencia-activo').value = String(ten.activo_id || '');
  document.getElementById('tenencia-plataforma').value = ten.plataforma || '';
  document.getElementById('tenencia-cantidad').value = String(ten.cantidad ?? '');
  document.getElementById('tenencia-precio').value = String(ten.precio_unitario ?? '');
  document.getElementById('tenencia-validation').style.display = 'none';
  updateTenenciaEditState();
}

function cancelarEdicionTenencia() {
  editingTenenciaId = null;
  limpiarTenenciaForm();
  document.getElementById('tenencia-validation').style.display = 'none';
  updateTenenciaEditState();
}

function renderTenenciasCharts() {
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;

  const byActivo = {};
  const byTipo = {};
  tenenciasCache.forEach(t => {
    const total = (Number(t.cantidad) || 0) * (Number(t.precio_unitario) || 0);
    const arsEq = toARS(total, t.moneda, tc);

    const keyActivo = t.activo || 'SIN ACTIVO';
    byActivo[keyActivo] = (byActivo[keyActivo] || 0) + arsEq;

    const keyTipo = String(t.tipo || 'otro').toUpperCase();
    byTipo[keyTipo] = (byTipo[keyTipo] || 0) + arsEq;
  });

  const pieLabels = Object.keys(byActivo);
  const pieData = pieLabels.map(l => byActivo[l]);
  const pieColors = ['#4a9eff', '#2dd4a0', '#f5a623', '#ff5c5c', '#c8f542', '#8b5cf6', '#22d3ee', '#f97316'];

  const typeLabels = Object.keys(byTipo);
  const typeData = typeLabels.map(l => byTipo[l]);

  if (tenenciasPieChart) tenenciasPieChart.destroy();
  if (tenenciasTypeChart) tenenciasTypeChart.destroy();

  const pieCtx = document.getElementById('tenenciasPieChart').getContext('2d');
  
  // Plugin para mostrar porcentajes en el pie chart
  const datalabelsPlugin = {
    id: 'datalabels',
    afterDatasetsDraw(chart) {
      const { ctx, data, chartArea: { left, top, width, height } } = chart;
      ctx.font = 'bold 12px DM Mono';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      chart.getDatasetMeta(0).data.forEach((arc, index) => {
        const { x: centerX, y: centerY } = arc.tooltipPosition();
        const value = data.datasets[0].data[index];
        const sum = data.datasets[0].data.reduce((a, b) => a + b, 0);
        const percentage = ((value / sum) * 100).toFixed(1);
        
        ctx.fillText(percentage + '%', centerX, centerY);
      });
    }
  };
  
  tenenciasPieChart = new Chart(pieCtx, {
    type: 'pie',
    data: {
      labels: pieLabels,
      datasets: [{
        data: pieData,
        backgroundColor: pieLabels.map((_, i) => pieColors[i % pieColors.length] + 'cc'),
        borderColor: '#0d0f14',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        datalabels: {},
        legend: {
          labels: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: $ ${Math.round(ctx.parsed).toLocaleString('es-AR')}`
          }
        }
      }
    },
    plugins: [datalabelsPlugin]
  });

  const typeCtx = document.getElementById('tenenciasTypeChart').getContext('2d');
  tenenciasTypeChart = new Chart(typeCtx, {
    type: 'bar',
    data: {
      labels: typeLabels,
      datasets: [{
        label: 'ARS',
        data: typeData,
        backgroundColor: '#2dd4a0aa',
        borderColor: '#2dd4a0',
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => '$ ' + Math.round(ctx.parsed.y).toLocaleString('es-AR')
          }
        }
      },
      scales: {
        x: { ticks: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

function renderTenenciasTables() {
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  const cripto = tenenciasCache.filter(t => t.tipo === 'cripto');
  const other = tenenciasCache.filter(t => t.tipo !== 'cripto');

  const criptoEmpty = document.getElementById('tenencias-cripto-empty');
  const criptoWrap = document.getElementById('tenencias-cripto-wrap');
  const criptoBody = document.getElementById('tenencias-cripto-body');

  const otherEmpty = document.getElementById('tenencias-other-empty');
  const otherWrap = document.getElementById('tenencias-other-wrap');
  const otherBody = document.getElementById('tenencias-other-body');

  criptoBody.innerHTML = '';
  otherBody.innerHTML = '';

  if (cripto.length === 0) {
    criptoEmpty.style.display = 'block';
    criptoWrap.style.display = 'none';
  } else {
    criptoEmpty.style.display = 'none';
    criptoWrap.style.display = 'block';
    cripto.forEach(t => {
      const total = (Number(t.cantidad) || 0) * (Number(t.precio_unitario) || 0);
      const eqArs = toARS(total, t.moneda, tc);
      const fechaCarga = formatTimestamp(t.created_at);
      const fechaActualizacion = formatTimestamp(t.updated_at || t.created_at);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.activo}</td>
        <td>${t.plataforma || '�'}</td>
        <td>${Number(t.cantidad).toLocaleString('es-AR')}</td>
        <td>${fmtTenenciaTotal(t.moneda, Number(t.precio_unitario) || 0)}</td>
        <td>${fmtTenenciaTotal(t.moneda, total)}</td>
        <td>$ ${Math.round(eqArs).toLocaleString('es-AR')}</td>
        <td>${fechaCarga}</td>
        <td>${fechaActualizacion}</td>
        <td style="text-align:center;"><button class="btn-icon" onclick="iniciarEdicionTenencia(${t.id})">?</button><button class="btn-icon" onclick="eliminarTenencia(${t.id})">?</button></td>`;
      criptoBody.appendChild(tr);
    });
  }

  if (other.length === 0) {
    otherEmpty.style.display = 'block';
    otherWrap.style.display = 'none';
  } else {
    otherEmpty.style.display = 'none';
    otherWrap.style.display = 'block';
    other.forEach(t => {
      const total = (Number(t.cantidad) || 0) * (Number(t.precio_unitario) || 0);
      const eqArs = toARS(total, t.moneda, tc);
      const fechaCarga = formatTimestamp(t.created_at);
      const fechaActualizacion = formatTimestamp(t.updated_at || t.created_at);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${String(t.tipo || '').toUpperCase()}</td>
        <td>${t.activo}</td>
        <td>${t.plataforma || '�'}</td>
        <td>${Number(t.cantidad).toLocaleString('es-AR')}</td>
        <td>${fmtTenenciaTotal(t.moneda, Number(t.precio_unitario) || 0)}</td>
        <td>${fmtTenenciaTotal(t.moneda, total)}</td>
        <td>$ ${Math.round(eqArs).toLocaleString('es-AR')}</td>
        <td>${fechaCarga}</td>
        <td>${fechaActualizacion}</td>
        <td style="text-align:center;"><button class="btn-icon" onclick="iniciarEdicionTenencia(${t.id})">?</button><button class="btn-icon" onclick="eliminarTenencia(${t.id})">?</button></td>`;
      otherBody.appendChild(tr);
    });
  }

  const totals = getTenenciasTotals();
  document.getElementById('tenencias-total-ars').textContent = '$ ' + Math.round(totals.arsEq).toLocaleString('es-AR');
  document.getElementById('tenencias-total-usd').textContent = 'US$ ' + totals.usdNominal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('tenencias-count').textContent = String(tenenciasCache.length);
  renderTenenciasCharts();
  updateTenenciaEditState();
}

async function registrarTenencia() {
  const activoId = parseInt(document.getElementById('tenencia-activo').value, 10);
  const activoRef = activosCatalogoCache.find(a => a.id === activoId);
  const plataforma = (document.getElementById('tenencia-plataforma').value || '').trim();
  const cantidad = parseFloat(document.getElementById('tenencia-cantidad').value);
  const precioUnitario = parseFloat(document.getElementById('tenencia-precio').value);
  const validEl = document.getElementById('tenencia-validation');
  const current = editingTenenciaId ? tenenciasCache.find(t => t.id === editingTenenciaId) : null;
  const canUseCurrent = Boolean(editingTenenciaId && current);

  // Para nuevas tenencias, el activo del cat�logo es obligatorio.
  // Para edici�n, si el activo original ya no existe en cat�logo, se permite editar cantidad/precio.
  const missingActivoForNew = !editingTenenciaId && !activoRef;
  const missingActivoForEdit = editingTenenciaId && !activoRef && !canUseCurrent;
  if (missingActivoForNew || missingActivoForEdit || !cantidad || !precioUnitario || cantidad <= 0 || precioUnitario <= 0) {
    validEl.style.display = 'block';
    return;
  }
  validEl.style.display = 'none';

  const ref = activoRef || current;
  const activo = (ref?.simbolo || ref?.activo || ref?.nombre || 'ACTIVO');
  const tenencia = {
    tipo: ref?.tipo || 'otro',
    activo_id: activoRef ? activoId : (current?.activo_id || null),
    activo,
    plataforma: plataforma || ref?.plataforma || '',
    cantidad,
    precio_unitario: precioUnitario,
    moneda: ref?.moneda || 'ARS',
  };

  if (editingTenenciaId) {
    await dbPut('tenencias', {
      ...tenencia,
      id: editingTenenciaId,
      timestamp: current?.timestamp || Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Tenencia actualizada');
  } else {
    await dbPut('tenencias', {
      ...tenencia,
      timestamp: Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Tenencia agregada');
  }

  cancelarEdicionTenencia();

  await loadTenenciasCache();
  renderTenenciasTables();
  recalc();
}

async function eliminarTenencia(id) {
  if (!confirm('�Eliminar esta tenencia?')) return;
  await dbDelete('tenencias', id);
  showToast('Tenencia eliminada');
  if (editingTenenciaId === id) {
    cancelarEdicionTenencia();
  }
  await loadTenenciasCache();
  renderTenenciasTables();
  recalc();
}

/* =====================================================
   PATRIMONIO
   ===================================================== */
const PATRIMONIO_HINTS = {
  casa: {
    label1: 'm2',
    ph1: 'Ej: 120',
    label2: 'Ubicaci�n',
    ph2: 'Ej: CABA',
  },
  vehiculo: {
    label1: 'Marca/Modelo',
    ph1: 'Ej: Toyota Corolla',
    label2: 'A�o / Patente',
    ph2: 'Ej: 2022 � AB123CD',
  },
  terreno: {
    label1: 'Superficie',
    ph1: 'Ej: 800 m2',
    label2: 'Ubicaci�n',
    ph2: 'Ej: Zona norte',
  },
  derecho: {
    label1: 'Origen',
    ph1: 'Ej: Regal�as, contrato',
    label2: 'Vencimiento',
    ph2: 'Ej: 12/2030',
  },
  otro: {
    label1: 'Dato 1',
    ph1: 'Dato clave',
    label2: 'Dato 2',
    ph2: 'Dato clave',
  },
};

function onPatrimonioTipoChange() {
  const tipo = document.getElementById('patrimonio-tipo').value;
  const cfg = PATRIMONIO_HINTS[tipo] || PATRIMONIO_HINTS.otro;
  document.getElementById('patrimonio-dato1-label').textContent = cfg.label1;
  document.getElementById('patrimonio-dato1').placeholder = cfg.ph1;
  document.getElementById('patrimonio-dato2-label').textContent = cfg.label2;
  document.getElementById('patrimonio-dato2').placeholder = cfg.ph2;
}

function limpiarPatrimonioForm() {
  document.getElementById('patrimonio-tipo').value = 'casa';
  document.getElementById('patrimonio-nombre').value = '';
  document.getElementById('patrimonio-valor').value = '';
  document.getElementById('patrimonio-moneda').value = 'ARS';
  document.getElementById('patrimonio-dato1').value = '';
  document.getElementById('patrimonio-dato2').value = '';
  document.getElementById('patrimonio-notas').value = '';
  onPatrimonioTipoChange();
}

function updatePatrimonioEditState() {
  const saveBtn = document.getElementById('patrimonio-save-btn');
  const cancelBtn = document.getElementById('patrimonio-cancel-btn');
  const status = document.getElementById('patrimonio-edit-status');

  if (editingPatrimonioId) {
    saveBtn.textContent = 'Guardar cambios';
    cancelBtn.style.display = 'inline-flex';
    const pat = patrimonioCache.find(p => p.id === editingPatrimonioId);
    status.style.display = 'block';
    status.textContent = 'Editando bien: ' + (pat?.nombre || '');
  } else {
    saveBtn.textContent = '+ Guardar bien';
    cancelBtn.style.display = 'none';
    status.style.display = 'none';
    status.textContent = '';
  }
}

function iniciarEdicionPatrimonio(id) {
  const pat = patrimonioCache.find(p => p.id === id);
  if (!pat) return;

  editingPatrimonioId = id;
  document.getElementById('patrimonio-tipo').value = pat.tipo || 'casa';
  document.getElementById('patrimonio-nombre').value = pat.nombre || '';
  document.getElementById('patrimonio-valor').value = String(pat.valor ?? '');
  document.getElementById('patrimonio-moneda').value = pat.moneda || 'ARS';
  document.getElementById('patrimonio-dato1').value = pat.dato1 || '';
  document.getElementById('patrimonio-dato2').value = pat.dato2 || '';
  document.getElementById('patrimonio-notas').value = pat.notas || '';
  document.getElementById('patrimonio-validation').style.display = 'none';
  onPatrimonioTipoChange();
  updatePatrimonioEditState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelarEdicionPatrimonio() {
  editingPatrimonioId = null;
  limpiarPatrimonioForm();
  document.getElementById('patrimonio-validation').style.display = 'none';
  updatePatrimonioEditState();
}

async function loadPatrimonioCache() {
  if (!db) return;
  try {
    const all = await dbGetAll('patrimonio');
    debugLog('patrimonio loaded:', all.length, 'items');
    all.sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
    patrimonioCache = all;
  } catch (e) {
    debugError('Error loading patrimonio:', e);
  }
}

function renderPatrimonioChart() {
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  const byTipo = {};

  patrimonioCache.forEach(p => {
    const tipo = String(p.tipo || 'otro').toUpperCase();
    const arsEq = toARS(Number(p.valor) || 0, p.moneda || 'ARS', tc);
    byTipo[tipo] = (byTipo[tipo] || 0) + arsEq;
  });

  const labels = Object.keys(byTipo);
  const data = labels.map(l => byTipo[l]);

  if (patrimonioTypeChart) patrimonioTypeChart.destroy();
  const ctx = document.getElementById('patrimonioTypeChart').getContext('2d');
  patrimonioTypeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: '#4a9effaa',
        borderColor: '#4a9eff',
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => '$ ' + Math.round(c.parsed.y).toLocaleString('es-AR') } }
      },
      scales: {
        x: { ticks: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

function renderPatrimonioTable() {
  const empty = document.getElementById('patrimonio-empty');
  const wrap = document.getElementById('patrimonio-wrap');
  const body = document.getElementById('patrimonio-body');
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;

  body.innerHTML = '';
  if (patrimonioCache.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    document.getElementById('patrimonio-total-ars').textContent = '$ 0';
    document.getElementById('patrimonio-total-usd').textContent = 'US$ 0';
    document.getElementById('patrimonio-count').textContent = '0';
    renderPatrimonioChart();
    return;
  }

  empty.style.display = 'none';
  wrap.style.display = 'block';

  let totalArsEq = 0;
  let totalUsd = 0;

  patrimonioCache.forEach(p => {
    const valor = Number(p.valor) || 0;
    const arsEq = toARS(valor, p.moneda || 'ARS', tc);
    totalArsEq += arsEq;
    if (p.moneda === 'USD') totalUsd += valor;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${String(p.tipo || '').toUpperCase()}</td>
      <td>${p.nombre || '�'}</td>
      <td>${p.moneda || 'ARS'}</td>
      <td>${p.moneda === 'USD' ? fmtUSD(valor) : fmtARS(valor)}</td>
      <td>${fmtARS(arsEq)}</td>
      <td>${p.dato1 || '�'}</td>
      <td>${p.dato2 || '�'}</td>
      <td>${p.notas || '�'}</td>
      <td>${formatTimestamp(p.updatedAt || p.timestamp)}</td>
      <td style="text-align:center;"><button class="btn-icon" onclick="iniciarEdicionPatrimonio(${p.id})">?</button> <button class="btn-icon" onclick="eliminarPatrimonio(${p.id})">?</button></td>`;
    body.appendChild(tr);
  });

  document.getElementById('patrimonio-total-ars').textContent = fmtARS(totalArsEq);
  document.getElementById('patrimonio-total-usd').textContent = fmtUSD(totalUsd);
  document.getElementById('patrimonio-count').textContent = String(patrimonioCache.length);
  renderPatrimonioChart();
}

async function registrarPatrimonio() {
  const tipo = document.getElementById('patrimonio-tipo').value;
  const nombre = (document.getElementById('patrimonio-nombre').value || '').trim();
  const valor = parseFloat(document.getElementById('patrimonio-valor').value);
  const moneda = document.getElementById('patrimonio-moneda').value;
  const dato1 = (document.getElementById('patrimonio-dato1').value || '').trim();
  const dato2 = (document.getElementById('patrimonio-dato2').value || '').trim();
  const notas = (document.getElementById('patrimonio-notas').value || '').trim();
  const validEl = document.getElementById('patrimonio-validation');

  if (!nombre || !Number.isFinite(valor) || valor <= 0) {
    validEl.style.display = 'block';
    return;
  }
  validEl.style.display = 'none';

  if (editingPatrimonioId) {
    const current = patrimonioCache.find(p => p.id === editingPatrimonioId);
    await dbPut('patrimonio', {
      ...current,
      tipo,
      nombre,
      valor,
      moneda,
      dato1,
      dato2,
      notas,
      id: editingPatrimonioId,
      timestamp: current?.timestamp || Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Bien actualizado');
  } else {
    await dbPut('patrimonio', {
      tipo,
      nombre,
      valor,
      moneda,
      dato1,
      dato2,
      notas,
      timestamp: Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Bien agregado al patrimonio');
  }

  limpiarPatrimonioForm();
  await loadPatrimonioCache();
  renderPatrimonioTable();
  cancelarEdicionPatrimonio();
}

async function eliminarPatrimonio(id) {
  if (!confirm('�Eliminar este bien del patrimonio?')) return;
  await dbDelete('patrimonio', id);
  showToast('Bien eliminado del patrimonio');
  await loadPatrimonioCache();
  renderPatrimonioTable();
  if (editingPatrimonioId === id) {
    cancelarEdicionPatrimonio();
  }
}

/* =====================================================
   NEGOCIOS
   ===================================================== */
function initVentaFecha() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('venta-fecha').value = today;
}

async function loadNegociosEmpresasCache() {
  if (!db) return;
  try {
    const all = await dbGetAll('negocios_empresas');
    debugLog('negocios_empresas loaded:', all.length, 'items');
    all.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    negociosEmpresasCache = all;
  } catch (e) {
    debugError('Error loading negocios_empresas:', e);
  }
}

async function loadNegociosVentasCache() {
  if (!db) return;
  try {
    const all = await dbGetAll('negocios_ventas');
    debugLog('negocios_ventas loaded:', all.length, 'items');
    all.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    negociosVentasCache = all;
  } catch (e) {
    debugError('Error loading negocios_ventas:', e);
  }
}

function renderNegociosEmpresaSelector() {
  const sel = document.getElementById('venta-empresa');
  sel.innerHTML = '<option value="">Seleccion� una empresa</option>';

  negociosEmpresasCache.forEach(n => {
    const opt = document.createElement('option');
    opt.value = String(n.id);
    opt.textContent = n.nombre;
    sel.appendChild(opt);
  });
}

function renderNegociosEmpresasTable() {
  const empty = document.getElementById('negocios-empresas-empty');
  const wrap = document.getElementById('negocios-empresas-wrap');
  const body = document.getElementById('negocios-empresas-body');
  body.innerHTML = '';

  if (negociosEmpresasCache.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  wrap.style.display = 'block';

  negociosEmpresasCache.forEach(n => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${n.nombre || '�'}</td>
      <td>${n.rubro || '�'}</td>
      <td>${n.descripcion || '�'}</td>
      <td style="text-align:center;"><button class="btn-icon" onclick="eliminarNegocioEmpresa(${n.id})">?</button></td>`;
    body.appendChild(tr);
  });
}

async function registrarNegocioEmpresa() {
  const nombre = (document.getElementById('negocio-nombre').value || '').trim();
  const rubro = (document.getElementById('negocio-rubro').value || '').trim();
  const descripcion = (document.getElementById('negocio-descripcion').value || '').trim();
  const validEl = document.getElementById('negocio-empresa-validation');

  if (!nombre) {
    validEl.style.display = 'block';
    return;
  }
  validEl.style.display = 'none';

  try {
    await dbPut('negocios_empresas', {
      nombre,
      rubro,
      descripcion,
      timestamp: Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Empresa agregada');

    document.getElementById('negocio-nombre').value = '';
    document.getElementById('negocio-rubro').value = '';
    document.getElementById('negocio-descripcion').value = '';

    await loadNegociosEmpresasCache();
    renderNegociosEmpresasTable();
    renderNegociosEmpresaSelector();
  } catch (err) {
    debugError('Error al guardar empresa:', err);
    showToast('Error al guardar empresa', 'error');
  }
}

async function eliminarNegocioEmpresa(id) {
  if (!confirm('�Eliminar esta empresa?')) return;
  await dbDelete('negocios_empresas', id);
  showToast('Empresa eliminada');
  await loadNegociosEmpresasCache();
  renderNegociosEmpresasTable();
  renderNegociosEmpresaSelector();
  renderNegociosVentasTable();
}

function renderNegociosChart() {
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;
  const byEmpresa = {};

  negociosVentasCache.forEach(v => {
    const nombre = v.empresaNombre || 'SIN EMPRESA';
    const arsEq = toARS(Number(v.monto) || 0, v.moneda || 'ARS', tc);
    byEmpresa[nombre] = (byEmpresa[nombre] || 0) + arsEq;
  });

  const labels = Object.keys(byEmpresa);
  const data = labels.map(l => byEmpresa[l]);

  if (negociosEmpresaChart) negociosEmpresaChart.destroy();
  const ctx = document.getElementById('negociosEmpresaChart').getContext('2d');
  negociosEmpresaChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: '#2dd4a0aa',
        borderColor: '#2dd4a0',
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => '$ ' + Math.round(c.parsed.y).toLocaleString('es-AR') } }
      },
      scales: {
        x: { ticks: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9a9790', font: { family: 'DM Mono', size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

function renderNegociosVentasTable() {
  const empty = document.getElementById('negocios-ventas-empty');
  const wrap = document.getElementById('negocios-ventas-wrap');
  const body = document.getElementById('negocios-ventas-body');
  const tc = parseFloat(document.getElementById('tcambio').value) || 1200;

  body.innerHTML = '';
  if (negociosVentasCache.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    document.getElementById('negocios-total-ars').textContent = '$ 0';
    document.getElementById('negocios-total-usd').textContent = 'US$ 0';
    document.getElementById('negocios-ticket-prom').textContent = '$ 0';
    renderNegociosChart();
    return;
  }

  empty.style.display = 'none';
  wrap.style.display = 'block';

  let totalArsEq = 0;
  let totalUsd = 0;
  negociosVentasCache.forEach(v => {
    const monto = Number(v.monto) || 0;
    const arsEq = toARS(monto, v.moneda || 'ARS', tc);
    totalArsEq += arsEq;
    if (v.moneda === 'USD') totalUsd += monto;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatFecha(v.fecha)}</td>
      <td>${v.empresaNombre || '�'}</td>
      <td>${v.canal || '�'}</td>
      <td>${v.moneda || 'ARS'}</td>
      <td>${v.moneda === 'USD' ? fmtUSD(monto) : fmtARS(monto)}</td>
      <td>${fmtARS(arsEq)}</td>
      <td style="text-align:center;"><button class="btn-icon" onclick="eliminarNegocioVenta(${v.id})">?</button></td>`;
    body.appendChild(tr);
  });

  const avg = totalArsEq / (negociosVentasCache.length || 1);
  document.getElementById('negocios-total-ars').textContent = fmtARS(totalArsEq);
  document.getElementById('negocios-total-usd').textContent = fmtUSD(totalUsd);
  document.getElementById('negocios-ticket-prom').textContent = fmtARS(avg);
  renderNegociosChart();
}

async function registrarNegocioVenta() {
  const empresaId = parseInt(document.getElementById('venta-empresa').value, 10);
  const empresa = negociosEmpresasCache.find(n => n.id === empresaId);
  const fecha = document.getElementById('venta-fecha').value;
  const monto = parseFloat(document.getElementById('venta-monto').value);
  const moneda = document.getElementById('venta-moneda').value;
  const canal = (document.getElementById('venta-canal').value || '').trim();
  const validEl = document.getElementById('negocio-venta-validation');

  if (!empresa || !fecha || !Number.isFinite(monto) || monto <= 0) {
    validEl.style.display = 'block';
    return;
  }
  validEl.style.display = 'none';

  try {
    await dbPut('negocios_ventas', {
      empresaId,
      empresaNombre: empresa.nombre,
      fecha,
      monto,
      moneda,
      canal,
      timestamp: Date.now(),
      updatedAt: Date.now(),
    });
    showToast('Venta registrada');

    document.getElementById('venta-monto').value = '';
    document.getElementById('venta-canal').value = '';
    initVentaFecha();

    await loadNegociosVentasCache();
    renderNegociosVentasTable();
  } catch (err) {
    debugError('Error al guardar venta:', err);
    showToast('Error al guardar venta', 'error');
  }
}

async function eliminarNegocioVenta(id) {
  if (!confirm('�Eliminar esta venta?')) return;
  await dbDelete('negocios_ventas', id);
  showToast('Venta eliminada');
  await loadNegociosVentasCache();
  renderNegociosVentasTable();
}

function buildAportesPlan(horizonteYears, tc, aporteMensualBase) {
  const totalMonths = horizonteYears * 12;
  const monthlyPlan = Array.from({ length: totalMonths }, () => aporteMensualBase);

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let extraCapital = 0;

  const overrides = {};
  aportesCache.forEach(ap => {
    const aporteDate = new Date(ap.fecha + 'T00:00:00');
    if (Number.isNaN(aporteDate.getTime())) return;

    const aporteARS = toARS(Number(ap.monto) || 0, ap.moneda, tc);
    const monthDiff = (aporteDate.getFullYear() - currentMonthStart.getFullYear()) * 12
      + (aporteDate.getMonth() - currentMonthStart.getMonth());

    if (monthDiff < 0) {
      // Aportes anteriores al mes actual ya forman parte del capital hoy.
      extraCapital += aporteARS;
      return;
    }

    if (monthDiff >= totalMonths) return;
    const idx = monthDiff;
    overrides[idx] = (overrides[idx] || 0) + aporteARS;
  });

  Object.keys(overrides).forEach(k => {
    const idx = parseInt(k, 10);
    monthlyPlan[idx] = overrides[idx];
  });

  return { extraCapital, monthlyPlan };
}

/* =====================================================
   HELPERS
   ===================================================== */
function setCurrency(c) {
  currency = c;
  document.getElementById('btn-ars').classList.toggle('active', c === 'ARS');
  document.getElementById('btn-usd').classList.toggle('active', c === 'USD');
  document.getElementById('m-currency-label').textContent = 'en ' + c + ' al final del horizonte';
  saveConfigDB();
  recalc();
}

function checkDist() {
  let total = 0;
  INST.forEach(i => {
    if (i.enabled) {
      total += parseFloat(document.getElementById(i.id + '-dist').value) || 0;
    }
  });
  document.getElementById('dist-total').textContent    = total.toFixed(0) + '%';
  document.getElementById('dist-warn').style.display  = Math.abs(total - 100) > 1 ? 'block' : 'none';
}

function redistributeDist(changedInstId) {
  const changedInst = INST.find(i => i.id === changedInstId);
  if (!changedInst) return;

  // Get enabled instruments
  const enabled = INST.filter(i => i.enabled);
  
  if (enabled.length === 0) return;
  
  if (enabled.length === 1) {
    // Only one enabled: set to 100%
    const el = document.getElementById(changedInstId + '-dist');
    if (el) el.value = 100;
  } else {
    // Multiple enabled: distribute proportionally
    let totalDist = 0;
    enabled.forEach(inst => {
      const val = parseFloat(document.getElementById(inst.id + '-dist').value) || inst.defaultDist || 0;
      totalDist += val;
    });
    
    if (totalDist === 0) totalDist = 1; // Avoid division by zero
    
    const factor = 100 / totalDist;
    enabled.forEach(inst => {
      const el = document.getElementById(inst.id + '-dist');
      if (el) {
        const newVal = (parseFloat(el.value) || inst.defaultDist || 0) * factor;
        el.value = Math.round(newVal * 2) / 2; // Round to nearest 0.5
      }
    });
  }
  
  checkDist();
}

function fmtNum(n) {
  const tc  = parseFloat(document.getElementById('tcambio').value) || 1200;
  const val = currency === 'USD' ? Math.round(n / tc) : Math.round(n);
  const sym = currency === 'USD' ? 'US$ ' : '$ ';
  return sym + val.toLocaleString('es-AR');
}

function fmtARS(n) {
  return '$ ' + Math.round(n).toLocaleString('es-AR');
}

function fmtUSD(n) {
  return 'US$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberToWords(num) {
  if (num === 0) return 'cero';
  if (num < 0) return 'menos ' + numberToWords(-num);
  
  // Para n�meros muy grandes, simplemente mostrar el n�mero redondeado
  if (num >= 1000000000000) {
    return Math.round(num / 1000000000000) + ' billones';
  }
  
  const ones = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'diecis�is', 'diecisiete', 'dieciocho', 'diecinueve'];
  
  function convertLessThanThousand(n) {
    let result = '';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    
    if (h > 0) {
      const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
      result += hundreds[h];
    }
    
    if (t > 1) {
      if (result) result += ' ';
      result += tens[t];
      if (u > 0) result += ' y ' + ones[u];
    } else if (t === 1) {
      if (result) result += ' ';
      result += teens[u];
    } else if (u > 0) {
      if (result) result += ' ';
      result += ones[u];
    }
    
    return result;
  }
  
  const groups = [];
  let tempNum = Math.floor(num);
  while (tempNum > 0) {
    groups.push(tempNum % 1000);
    tempNum = Math.floor(tempNum / 1000);
  }
  
  let result = '';
  const scales = ['', 'mil', 'millones', 'mil millones', 'billones'];
  
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] > 0) {
      const groupText = convertLessThanThousand(groups[i]);
      if (result) result += ' ';
      
      if (i === 0) {
        result += groupText;
      } else if (i === 1) {
        result += (groups[i] === 1 ? 'mil' : groupText + ' mil');
      } else if (i < scales.length) {
        if (groups[i] === 1) {
          result += 'un ' + scales[i];
        } else {
          result += groupText + ' ' + scales[i];
        }
      }
    }
  }
  
  return result.trim();
}

function renderMonthlyYields() {
  const tnaToMonthly = tna => (Math.pow(1 + (tna / 100), 1 / 12) - 1) * 100;
  const fimaMonthly = tnaToMonthly(MARKET_TNA_COMPARATASAS.fima);
  const mpMonthly = tnaToMonthly(MARKET_TNA_COMPARATASAS.mp);
  const ualaMonthly = tnaToMonthly(MARKET_TNA_COMPARATASAS.uala);

  document.getElementById('mk-fima').textContent = fimaMonthly.toFixed(2).replace('.', ',') + '% mensual';
  document.getElementById('mk-mp').textContent   = mpMonthly.toFixed(2).replace('.', ',') + '% mensual';
  document.getElementById('mk-uala').textContent = ualaMonthly.toFixed(2).replace('.', ',') + '% mensual';
}

async function refreshMarketData() {
  const btcEl = document.getElementById('mk-btc-usd');
  const usdtEl = document.getElementById('mk-usdt-ars');
  btcEl.textContent = 'Actualizando...';
  usdtEl.textContent = 'Actualizando...';

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd,ars');
    if (!res.ok) throw new Error('No se pudo obtener cotizaciones');
    const data = await res.json();

    const btcUsd = data?.bitcoin?.usd;
    const usdtArs = data?.tether?.ars;

    btcEl.textContent = Number.isFinite(btcUsd) ? fmtUSD(btcUsd) : 'Sin dato';
    usdtEl.textContent = Number.isFinite(usdtArs) ? fmtARS(usdtArs) : 'Sin dato';
  } catch (e) {
    btcEl.textContent = 'Error de red';
    usdtEl.textContent = 'Error de red';
  }
}

function renderGoalCalendar(horizonteYears) {
  const today = new Date();
  const nowYear = today.getFullYear();
  const nowMonth = today.getMonth();
  const totalMonths = horizonteYears * 12;
  const targetDate = new Date(nowYear, nowMonth + totalMonths, 1);

  document.getElementById('goal-current').textContent = `${ES_MONTHS_SHORT[nowMonth]} ${String(nowYear).slice(-2)}`;
  document.getElementById('goal-target').textContent = `${ES_MONTHS_SHORT[targetDate.getMonth()]} ${String(targetDate.getFullYear()).slice(-2)}`;
  document.getElementById('goal-remaining').textContent = `${totalMonths} meses`;

  const cal = document.getElementById('goal-calendar');
  cal.innerHTML = '';

  const start = new Date(nowYear, 0, 1);
  const cursor = new Date(start);

  while (cursor <= targetDate) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();

    const monthNode = document.createElement('div');
    const isPast = (y < nowYear) || (y === nowYear && m < nowMonth);
    const isCurrent = y === nowYear && m === nowMonth;
    const isTarget = y === targetDate.getFullYear() && m === targetDate.getMonth();

    let state = 'future';
    if (isPast) state = 'past';
    if (isCurrent) state = 'current';

    monthNode.className = `goal-month ${state}${isTarget ? ' target' : ''}`;
    monthNode.textContent = `${ES_MONTHS_SHORT[m]} ${String(y).slice(-2)}`;
    cal.appendChild(monthNode);

    cursor.setMonth(cursor.getMonth() + 1);
  }
}

/* =====================================================
   RECALC / PROYECCI�N
   ===================================================== */
function recalc() {
  try {
    checkDist();
    const capital   = parseMoneyInputById('capital');
    const aporteMen = parseMoneyInputById('aporte-men');
    const horizonte = parseInt(document.getElementById('horizonte').value)    || 10;
    const inflacion = parseFloat(document.getElementById('inflacion').value) / 100 || 0;
    const tc        = parseFloat(document.getElementById('tcambio').value)    || 1200;
    const { extraCapital, monthlyPlan } = buildAportesPlan(horizonte, tc, aporteMen);
    const capitalEfectivo = capital + extraCapital;

    // Only consider enabled instruments
    const instData = INST.filter(inst => inst.enabled).map(inst => {
      const tna  = parseFloat(document.getElementById(inst.id + '-tna').value) || 0;
      const comp = document.getElementById(inst.id + '-comp').value;
      const dist = (parseFloat(document.getElementById(inst.id + '-dist').value) || 0) / 100;
      const tea  = tnaToTea(tna, comp) / 100;
      return { ...inst, tea, dist };
    });

  const years = Array.from({ length: horizonte }, (_, i) => i + 1);

  const seriesData = instData.map(inst => {
    let cap = capitalEfectivo * inst.dist;
    const pts = [cap];
    for (let y = 0; y < horizonte; y++) {
      for (let m = 0; m < 12; m++) {
        const monthIdx = y * 12 + m;
        cap = cap * (1 + inst.tea / 12) + (monthlyPlan[monthIdx] || 0) * inst.dist;
      }
      pts.push(cap);
    }
    return pts;
  });

  const labels      = ['Inicio', ...years.map(y => 'A�o ' + y)];
  const totalByYear = labels.map((_, i) => seriesData.reduce((s, d) => s + d[i], 0));
  const totalFinal  = totalByYear[totalByYear.length - 1];
  const totalAportes = capitalEfectivo + monthlyPlan.reduce((sum, val) => sum + val, 0);
  const totalInteres = totalFinal - totalAportes;
  const rendPct = capitalEfectivo > 0 ? ((totalFinal / capitalEfectivo - 1) * 100) : 0;

  document.getElementById('m-final').textContent   = fmtNum(totalFinal);
  const finalAmount = currency === 'USD' ? Math.round(totalFinal / tc) : Math.round(totalFinal);
  const currency_label = currency === 'USD' ? 'd�lares' : 'pesos';
  document.getElementById('m-final-words').textContent = numberToWords(finalAmount) + ' ' + currency_label;
  document.getElementById('m-rend').textContent    = rendPct.toFixed(0) + '%';
  document.getElementById('m-aportes').textContent = fmtNum(totalAportes);
  document.getElementById('m-interes').textContent = fmtNum(Math.max(0, totalInteres));

  // Chart
  const toDisplay = v => currency === 'USD' ? Math.round(v / tc) : Math.round(v);

  const datasets = instData.map((inst, idx) => ({
    label:            inst.name,
    data:             seriesData[idx].map(toDisplay),
    borderColor:      inst.color,
    backgroundColor:  inst.color + '18',
    fill:             true,
    tension:          0.4,
    pointRadius:      4,
    pointHoverRadius: 6,
    borderWidth:      2,
    pointBackgroundColor: inst.color,
    pointBorderColor:     '#0d0f14',
    pointBorderWidth:     2,
  }));

  if (chartInstance) chartInstance.destroy();
  const ctx = document.getElementById('mainChart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1e28',
          borderColor:     'rgba(255,255,255,0.1)',
          borderWidth:     1,
          titleColor:      '#9a9790',
          bodyColor:       '#f0ede8',
          padding:         12,
          callbacks: {
            label: ctx => {
              const sym = currency === 'USD' ? 'US$ ' : '$ ';
              return '  ' + ctx.dataset.label + ': ' + sym + ctx.parsed.y.toLocaleString('es-AR');
            }
          }
        }
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#5c5a56', font: { size: 12, family: 'DM Mono' }, autoSkip: false, maxRotation: 0 }
        },
        y: {
          grid:  { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#5c5a56',
            font:  { size: 11, family: 'DM Mono' },
            callback: v => {
              const sym = currency === 'USD' ? 'US$' : '$';
              if (v >= 1_000_000_000) return sym + (v / 1_000_000_000).toFixed(1) + 'B';
              if (v >= 1_000_000)     return sym + (v / 1_000_000).toFixed(1) + 'M';
              if (v >= 1_000)         return sym + (v / 1_000).toFixed(0) + 'K';
              return v;
            }
          }
        }
      }
    }
  });

  // Legend
  const leg = document.getElementById('chart-legend');
  leg.innerHTML = instData.map(i =>
    `<div class="legend-item">
      <div class="legend-dot" style="background:${i.color}"></div>
      <span>${i.name}</span>
      <span style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text3);">${(i.dist * 100).toFixed(0)}%</span>
    </div>`
  ).join('');

  // Tabla anual
  const head = document.getElementById('tabla-head');
  const body = document.getElementById('tabla-body');
  head.innerHTML = '<th style="width:80px;">A�o</th>'
    + instData.map(i => `<th>${i.name}</th>`).join('')
    + '<th>Total</th><th>Real (inflac.)</th>';
  body.innerHTML = '';

  years.forEach(y => {
    const instVals = seriesData.map(d => d[y]);
    const total    = instVals.reduce((a, b) => a + b, 0);
    const real     = total / Math.pow(1 + inflacion, y);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>A�o ${y}</td>`
      + instVals.map(v => `<td>${fmtNum(v)}</td>`).join('')
      + `<td class="total-col">${fmtNum(total)}</td>`
      + `<td class="real-col">${fmtNum(real)}</td>`;
    body.appendChild(tr);
  });

  // Tabla mensual
  const monthlyHead = document.getElementById('tabla-mensual-head');
  const monthlyBody = document.getElementById('tabla-mensual-body');
  monthlyHead.innerHTML = '<th style="width:90px;">Mes</th>'
    + instData.map(i => `<th>${i.name}</th>`).join('')
    + '<th>Total</th><th>Real (inflac.)</th>';
  monthlyBody.innerHTML = '';

  const monthCaps = instData.map(inst => capitalEfectivo * inst.dist);
  const totalMonths = horizonte * 12;

  for (let month = 1; month <= totalMonths; month++) {
    for (let i = 0; i < instData.length; i++) {
      const aporteMes = monthlyPlan[month - 1] || 0;
      monthCaps[i] = monthCaps[i] * (1 + instData[i].tea / 12) + aporteMes * instData[i].dist;
    }

    const monthTotal = monthCaps.reduce((sum, v) => sum + v, 0);
    const monthReal = monthTotal / Math.pow(1 + inflacion, month / 12);

    const tr = document.createElement('tr');
    tr.innerHTML = `<td>Mes ${month}</td>`
      + monthCaps.map(v => `<td>${fmtNum(v)}</td>`).join('')
      + `<td class="total-col">${fmtNum(monthTotal)}</td>`
      + `<td class="real-col">${fmtNum(monthReal)}</td>`;
    monthlyBody.appendChild(tr);
  }

  // Re-render tablas dependientes de TC (equivalente ARS updates)
  renderAportesTable();
  renderTenenciasTables();
  renderPatrimonioTable();
  renderNegociosVentasTable();

  // Calendario de meta
  // renderGoalCalendar(horizonte); // Comentado: elementos faltantes en HTML

  // Estado de objetivo en curso
  updateObjectiveView();
  } catch (e) {
    debugError('Recalc error:', e);
    document.getElementById('m-final').textContent = '? Error';
    document.getElementById('m-rend').textContent = '? Error';
  }
}

/* =====================================================
   INIT
   ===================================================== */
async function init() {
  buildInstruments();
  initAporteFecha();
  initVentaFecha();
  onPatrimonioTipoChange();
  // renderMonthlyYields(); // Comentado: elementos faltantes en HTML
  showMotivationalPhrase();

  try {
    const configRecords = await dbGetAll('config').catch(() => []);
    if (configRecords && configRecords.length > 0) {
      const configRecord = configRecords[0];
      planState.configId = configRecord.id; // Guardar ID para futuras actualizaciones
      if (configRecord && configRecord.value) {
        const configData = JSON.parse(configRecord.value);
        applyConfig(configData);
        buildInstruments(); // Rebuild after loading config to reflect enabled state
      }
    }
    await loadObjetivoFromDB();
    await renderAportesTable();
    await loadTenenciasCache();
    await loadActivosCatalogoCache();
    await loadPatrimonioCache();
    await loadNegociosEmpresasCache();
    await loadNegociosVentasCache();
  } catch (e) {
    debugWarn('Error al cargar datos:', e);
  }

  renderTenenciasTables();
  renderBbddTable();
  renderActivoSelector();
  updateBbddEditState();
  updatePatrimonioEditState();
  renderPatrimonioTable();
  renderNegociosEmpresasTable();
  renderNegociosEmpresaSelector();
  renderNegociosVentasTable();

  setTab(activeTab, false);
  if (planTicker) clearInterval(planTicker);
  planTicker = setInterval(updateObjectiveView, 1000);

  // await refreshMarketData(); // Comentado: elementos HTML no existen en el nuevo dise�o
  recalc();
}

// Auto-init on page load
async function autoInit() {
  try {
    await openDB();
    
    // Event listeners para Enter en login
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    if (usernameInput) {
      usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginUser();
      });
    }
    if (passwordInput) {
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginUser();
      });
    }
    
    if (loadSession()) {
      showApp();
    } else {
      showLogin();
    }
  } catch (err) {
    debugError('Startup error:', err);
    document.body.innerHTML = `<div style="padding:20px; color:red;">? Error: ${err.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', autoInit);


