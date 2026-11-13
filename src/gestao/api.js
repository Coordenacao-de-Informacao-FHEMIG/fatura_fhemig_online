// Cliente da API da Área do gestor (mesmo domínio: /api). Sem API (Netlify), o site usa o protótipo.

class ErroApi extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

async function requisitar(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Não foi possível falar com o servidor da FHEMIG.');
  }
  const json = (r.headers.get('content-type') || '').includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new ErroApi(r.status, json.erro || `Erro ${r.status} no servidor.`);
  return json;
}

let disponivel = null;
/** true quando o site roda com a API (VM); false no Netlify/dev sem API. */
export function apiDisponivel() {
  disponivel ??= fetch('/api/saude', { cache: 'no-store' })
    .then(async (r) => r.ok && (r.headers.get('content-type') || '').includes('application/json') && (await r.json()).servico === 'fatura-fhemig-api')
    .catch(() => false);
  return disponivel;
}

export const api = {
  entrar: (email, senha) => requisitar('POST', '/sessao', { email, senha }),
  sessao: () => requisitar('GET', '/sessao').then((r) => r.usuario).catch((e) => {
    if (e.status === 401) return null;
    throw e;
  }),
  sair: () => requisitar('DELETE', '/sessao'),
  painel: (ate) => requisitar('GET', `/painel${ate ? `?ate=${encodeURIComponent(ate)}` : ''}`),
  enviar: (resumo) => requisitar('POST', '/processamentos', resumo),
};

/** SHA-256 (hex) de um ou mais arquivos; com vários, o hash dos hashes. */
export async function sha256DeArquivos(arquivos) {
  if (!crypto?.subtle) throw new Error('O navegador só calcula o SHA-256 em HTTPS.');
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const partes = [];
  for (const a of arquivos) partes.push(hex(await crypto.subtle.digest('SHA-256', await a.arrayBuffer())));
  return partes.length === 1 ? partes[0] : hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(partes.join(':'))));
}
