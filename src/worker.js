// "Backend" do Fatura Fhemig Online: roda dentro de um Web Worker, no proprio
// navegador. Une os tres motores (Hospitalar, Ambulatorial e ChecaProfissionais)
// e a base SIGTAP. Nenhum arquivo sai da maquina: os unicos fetch() sao para o
// proprio site (bases embutidas, planilhas da unidade e SIGTAP).
// Bases e SIGTAP sao sempre os embutidos no site (pasta bases/ e sigtap/ do dist):
// o usuario envia apenas o arquivo de producao.
import { gunzipSync, strFromU8 } from 'fflate';
import { lerPlanilha } from './engine/comum/planilha.js';
import {
  fonteCompacta, montarSigtapHospitalar, montarSigtapAmbulatorial, escolherSigtapPorCompetencia, desserializar,
} from './engine/sigtap/sigtap.js';
import { processarHospitalar } from './engine/hospitalar/processar.js';
import { processarAmbulatorial } from './engine/ambulatorial/processar.js';
import { processarChecaProfissionais } from './engine/checa/processar.js';

const BASE = new URL(import.meta.env.BASE_URL || '/', self.location.origin);
const url = (rel) => new URL(rel, BASE).href;

async function baixar(rel) {
  const r = await fetch(url(rel), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Não foi possível carregar ${rel} do servidor (HTTP ${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}

function gunzipSeNecessario(bytes) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

// ---------------------------------------------------------------------------
// SIGTAP: bases embutidas (public/sigtap)
// ---------------------------------------------------------------------------
const cacheSigtap = new Map();

async function listarSigtap() {
  const lista = [];
  try {
    const indice = JSON.parse(strFromU8(await baixar('sigtap/indice.json')));
    for (const b of indice.bases) lista.push({ id: `embutida:${b.arquivo}`, origem: 'embutida', ...b });
  } catch {
    /* site sem bases embutidas */
  }
  return lista;
}

async function carregarJsonSigtap(item) {
  if (cacheSigtap.has(item.id)) return cacheSigtap.get(item.id);
  const bytes = await baixar(`sigtap/${item.arquivo}`);
  const json = JSON.parse(strFromU8(gunzipSeNecessario(bytes)));
  const entrada = { json };
  cacheSigtap.clear();
  cacheSigtap.set(item.id, entrada);
  return entrada;
}

/** SIGTAP sempre automatico: mesma competencia ou a anterior mais proxima (bases embutidas no site). */
async function sigtapPara(ferramenta, competencia, notify) {
  const todas = (await listarSigtap()).filter((b) => b.usos.includes(ferramenta));
  if (!todas.length) return null;
  const item = escolherSigtapPorCompetencia(todas, competencia);
  notify(`Preparando a base SIGTAP ${item.rotulo}...`);
  const ent = await carregarJsonSigtap(item);
  const chave = ferramenta === 'hospitalar' ? 'hosp' : 'amb';
  if (!ent[chave]) {
    if (ent.json.formato === 'sigtap-planilha-1') {
      if (!ent.json[chave]) throw new Error(`A planilha ${item.rotulo} não tem as colunas necessárias para o ${ferramenta === 'hospitalar' ? 'Hospitalar' : 'Ambulatorial'}.`);
      ent[chave] = desserializar(ent.json[chave]);
    } else if (chave === 'hosp') {
      ent.hosp = montarSigtapHospitalar(fonteCompacta(ent.json));
    } else {
      ent.amb = montarSigtapAmbulatorial(fonteCompacta(ent.json));
      ent.amb.competencia = ent.json.competencia || ent.amb.competencia;
    }
  }
  return { item, base: ent[chave] };
}

// ---------------------------------------------------------------------------
// Bases da unidade
// ---------------------------------------------------------------------------
let manifesto = null;
async function obterManifesto() {
  if (manifesto) return manifesto;
  try {
    manifesto = JSON.parse(strFromU8(await baixar('bases/manifest.json')));
  } catch {
    manifesto = { hospitalar: {}, ambulatorial: {}, checa: {} };
  }
  return manifesto;
}

/** slot: {nome, bytes} enviado pelo usuario (arquivos de producao), ou {servidor: caminho, nome} (bases embutidas). */
async function resolverArquivo(slot) {
  if (!slot) return null;
  if (slot.bytes) return { nome: slot.nome, bytes: new Uint8Array(slot.bytes), origem: 'seleção manual' };
  if (slot.servidor) return { nome: slot.nome, bytes: await baixar(slot.servidor), origem: 'base embutida no sistema' };
  return null;
}

async function resolverPlanilha(slot) {
  const a = await resolverArquivo(slot);
  if (!a) return null;
  return { ...a, planilha: await lerPlanilha(a.bytes, a.nome) };
}

// ---------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------
async function processar(ferramenta, p, notify) {
  if (ferramenta === 'hospitalar') {
    const bases = {
      servico: await resolverPlanilha(p.bases.servico),
      habilitacao: await resolverPlanilha(p.bases.habilitacao),
      profissionais: await resolverPlanilha(p.bases.profissionais),
    };
    const entrada = p.entrada.formato === 'txt' ? { formato: 'txt', nome: p.entrada.nome, bytes: new Uint8Array(p.entrada.bytes) } : p.entrada;
    const r = await processarHospitalar({
      entrada, bases, unidade: p.unidade, notify,
      obterSigtap: async (comp) => {
        const s = await sigtapPara('hospitalar', comp, notify);
        if (!s) throw new Error('Nenhuma base SIGTAP disponível para o Hospitalar. Fale com o administrador do sistema.');
        return { ...s.base, rotulo: `${s.item.rotulo} — ${s.item.motivo}` };
      },
    });
    delete r.rows;
    return r;
  }
  if (ferramenta === 'ambulatorial') {
    const bases = {};
    for (const t of ['profissionais', 'carga_horaria', 'servico_classificacao', 'habilitacao']) bases[t] = await resolverPlanilha(p.bases[t]);
    const r = await processarAmbulatorial({
      entrada: { nome: p.entrada.nome, bytes: new Uint8Array(p.entrada.bytes) }, bases, unidade: p.unidade, notify,
      obterSigtap: async (comp) => {
        const s = await sigtapPara('ambulatorial', comp, notify);
        return s ? { base: s.base, rotulo: s.item.rotulo, tipo: s.item.tipo, motivo: s.item.motivo } : null;
      },
    });
    delete r.registros;
    return r;
  }
  if (ferramenta === 'checa') {
    const r = await processarChecaProfissionais({
      tasy: await resolverArquivo(p.tasy), cnes: await resolverArquivo(p.cnes),
      adc: await resolverArquivo(p.adc), cbo: await resolverArquivo(p.cbo),
      unidade: p.unidade, notify,
    });
    delete r.res;
    return r;
  }
  throw new Error(`Ferramenta desconhecida: ${ferramenta}`);
}

self.onmessage = async (ev) => {
  const { id, tipo } = ev.data;
  const responder = (dados, transferir = []) => self.postMessage({ id, ...dados }, transferir);
  try {
    if (tipo === 'manifesto') return responder({ ok: true, dados: await obterManifesto() });
    if (tipo === 'sigtap-listar') return responder({ ok: true, dados: await listarSigtap() });
    if (tipo === 'processar') {
      const r = await processar(ev.data.ferramenta, ev.data.payload, (msg) => self.postMessage({ id, progresso: msg }));
      return responder({ ok: true, dados: r }, [r.arquivos.xlsx.bytes.buffer]);
    }
    throw new Error(`Mensagem desconhecida: ${tipo}`);
  } catch (erro) {
    return responder({ ok: false, erro: erro.message || String(erro), codigo: erro.codigo || '', log: erro.log || [] });
  }
};
