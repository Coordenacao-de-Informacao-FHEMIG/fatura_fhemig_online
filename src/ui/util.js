// Utilitarios da interface.

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapa qualquer texto vindo de arquivos antes de ir para o HTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function numero(v, casas = 0) {
  if (typeof v !== 'number') return esc(v);
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function competencia(aaaamm) {
  return aaaamm && /^\d{6}$/.test(aaaamm) ? `${aaaamm.slice(4)}/${aaaamm.slice(0, 4)}` : '—';
}

export function tamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function baixarArquivo(nome, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let toastTimer = null;
export function toast(mensagem, tipo = 'info') {
  const area = $('#toast');
  const cor = tipo === 'erro' ? 'bg-alerta text-white' : tipo === 'ok' ? 'bg-ok text-white' : 'bg-azul text-white';
  area.innerHTML = `<div class="pointer-events-auto max-w-xl rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${cor}" role="status">${esc(mensagem)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    area.innerHTML = '';
  }, 5000);
}

export const armazenamento = {
  ler(chave, padrao) {
    try {
      const v = localStorage.getItem(chave);
      return v === null ? padrao : JSON.parse(v);
    } catch {
      return padrao;
    }
  },
  gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* navegador sem armazenamento: segue sem lembrar */
    }
  },
};

export const ICONES = {
  hospital: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-6" aria-hidden="true"><path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-5h6v5"/><path d="M12 7v5M9.5 9.5h5"/></svg>',
  ambulatorio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-6" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-6" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 11.5a2.8 2.8 0 1 0 0-5.6M17 20a5 5 0 0 0-2.2-4.2"/></svg>',
  arquivo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-5" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-4" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" class="size-4" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  base: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-4" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
  girar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="size-4 girando" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
};
