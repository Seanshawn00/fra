// Supabase REST API Client - Sin dependencias externas
// Implementación minimalista con API fluida compatible

// Deshabilitar logs en producción
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const debugLog = isProduction ? () => {} : console.log;

const SUPABASE_URL = 'https://mpzpaccuqccjpmoilrhw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SQXRTT30mja_a2zyRX5x8g_PI85IjCW';

class QueryBuilder {
  constructor(client, table, method = 'GET') {
    this.client = client;
    this.table = table;
    this.method = method;
    this.filters = [];
    this.body = null;
  }

  select(columns = '*') {
    this.method = 'GET';
    this.columns = columns;
    return this;
  }

  insert(data) {
    this.method = 'POST';
    this.body = data;
    return this;
  }

  update(data) {
    this.method = 'PATCH';
    this.body = data;
    return this;
  }

  delete() {
    this.method = 'DELETE';
    return this;
  }

  eq(field, value) {
    this.filters.push(`${field}=eq.${value}`);
    return this;
  }

  single() {
    // No hacer nada especial, solo retornar this para que sea chainable
    return this;
  }

  async then(onFulfilled, onRejected) {
    try {
      const result = await this._execute();
      return onFulfilled(result);
    } catch (error) {
      if (onRejected) return onRejected(error);
      throw error;
    }
  }

  async _execute() {
    const headers = {
      'apikey': this.client.key,
      'Authorization': `Bearer ${this.client.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };

    let path = `/rest/v1/${this.table}`;
    let url = this.client.url + path;

    if (this.method === 'GET') {
      url += `?select=${this.columns || '*'}`;
      if (this.filters.length) url += '&' + this.filters.join('&');
    } else if (this.filters.length) {
      url += '?' + this.filters.join('&');
    }

    try {
      const fetchOptions = {
        method: this.method,
        headers,
      };
      
      // No pasar body en GET/HEAD requests
      if (this.method !== 'GET' && this.method !== 'HEAD') {
        fetchOptions.body = this.body ? JSON.stringify(this.body) : null;
      }
      
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(error.message || error.error_description || `Error ${response.status}`);
      }

      if (response.status === 204) return { data: null, error: null };

      const data = await response.json();
      return { data, error: null };
    } catch (error) {
      debugLog(`API Error [${this.method} ${path}]:`, error);
      return { data: null, error: { message: error.message } };
    }
  }
}

class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
  }

  from(table) {
    return new QueryBuilder(this, table);
  }
}

debugLog('✅ Supabase REST Client cargado');

// Crear cliente global
window.supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
debugLog('🌐 Conectado a:', SUPABASE_URL);

// Esperar a que el document esté COMPLETAMENTE CARGADO (incluyendo script.js)
// antes de disparar el evento supabaseReady
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Esperar un tick más para asegurar que script.js está ejecutado
    setTimeout(() => {
      debugLog('📡 Disparando evento supabaseReady');
      document.dispatchEvent(new Event('supabaseReady'));
    }, 10);
  });
} else if (document.readyState === 'interactive' || document.readyState === 'complete') {
  // DOM ya está completado
  setTimeout(() => {
    debugLog('📡 Disparando evento supabaseReady (DOM ready)');
    document.dispatchEvent(new Event('supabaseReady'));
  }, 10);
}





