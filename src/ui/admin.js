// Área do gestor: administração de usuários (só perfil admin; a API confere de novo).
// Cria usuários com senha temporária, muda perfil e unidades, desativa e redefine senha.
import { $, esc, toast } from './util.js';
import { api } from '../gestao/api.js';

export const PERFIS = { faturista: 'Faturista', gestor_unidade: 'Gestor de unidade', gestor_central: 'Gestão central', admin: 'Administrador' };
const DESCRICAO_PERFIL = {
  faturista: 'Envia resultados das próprias unidades. Não vê o painel.',
  gestor_unidade: 'Vê o painel e o histórico só das próprias unidades.',
  gestor_central: 'Vê o painel e o histórico de todas as unidades.',
  admin: 'Vê todas as unidades e gerencia os usuários.',
};
const PRECISA_UNIDADE = ['faturista', 'gestor_unidade'];

export const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function situacao(u) {
  if (!u.ativo) return '<span class="etiqueta etiqueta-neutra">Inativo</span>';
  if (u.trocar_senha) {
    const vencida = u.senha_expira_em && new Date(u.senha_expira_em) <= new Date();
    return vencida
      ? '<span class="etiqueta etiqueta-pendente">Senha temporária vencida</span>'
      : '<span class="etiqueta etiqueta-servidor">Aguardando 1º acesso</span>';
  }
  return '<span class="etiqueta etiqueta-ok">Ativo</span>';
}

/** Mostra a senha temporária uma única vez, com botão de copiar. */
function mostrarSenha({ usuario, senha_temporaria: senha, expira_em: expira }) {
  const d = $('#dialogo-gestor');
  d.oncancel = null;
  d.innerHTML = `<div class="bg-white p-6 sm:p-8">
    <h2 class="text-[22px]">Senha temporária</h2>
    <p class="mt-1 text-sm text-suave">Para <strong>${esc(usuario.nome)}</strong> (${esc(usuario.email)}).</p>
    <div class="mt-5 flex items-center gap-2 rounded-lg border border-linha bg-fundo px-4 py-3">
      <code class="flex-1 text-[20px] font-bold tracking-wider text-azul" data-senha>${esc(senha)}</code>
      <button type="button" class="btn-secundario" data-copiar>Copiar</button>
    </div>
    <ul class="mt-4 list-disc space-y-1 pl-5 text-[13px] text-suave">
      <li>Ela aparece <strong>só agora</strong>. Passe à pessoa por canal interno (Teams, telefone), não por e-mail externo.</li>
      <li>Vale até <strong>${esc(dataHora(expira))}</strong>. No primeiro acesso a pessoa define uma senha própria.</li>
    </ul>
    <div class="mt-7 flex justify-end"><button type="button" class="btn-primario px-6" data-fechar>Entendi</button></div>
  </div>`;
  d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
  d.querySelector('[data-copiar]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(senha);
      toast('Senha copiada.', 'ok');
    } catch {
      toast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'erro');
    }
  });
  d.showModal();
}

/** Formulário de criar (usuario = null) ou editar. Resolve true se salvou. */
function abrirFormulario(usuario, unidades, emailAtual) {
  const novo = !usuario;
  const proprio = !novo && usuario.email === emailAtual;
  const u = usuario || { nome: '', email: '', perfil: 'gestor_unidade', unidades: [], ativo: true };
  const d = $('#dialogo-gestor');
  d.oncancel = null;
  d.innerHTML = `<form method="dialog" class="max-h-[85vh] overflow-y-auto bg-white p-6 sm:p-8" novalidate>
    <div class="flex items-start justify-between gap-4">
      <h2 class="text-[22px]">${novo ? 'Novo usuário' : 'Editar usuário'}</h2>
      <button type="button" class="btn-sutil text-suave" data-fechar aria-label="Fechar">✕</button>
    </div>
    <div class="mt-6 space-y-4">
      <label class="block"><span class="rotulo">E-mail institucional</span>
        <input type="email" class="campo mt-1" name="email" required maxlength="200" value="${esc(u.email)}" ${novo ? '' : 'disabled'} /></label>
      <label class="block"><span class="rotulo">Nome</span>
        <input type="text" class="campo mt-1" name="nome" required maxlength="120" value="${esc(u.nome)}" /></label>
      <label class="block"><span class="rotulo">Perfil</span>
        <select class="campo mt-1" name="perfil" ${proprio ? 'disabled' : ''}>${Object.entries(PERFIS).map(([id, nome]) =>
          `<option value="${esc(id)}" ${id === u.perfil ? 'selected' : ''}>${esc(nome)}</option>`).join('')}</select>
        <span class="mt-1 block text-[13px] text-apagado" data-descricao-perfil></span></label>
      <fieldset data-unidades>
        <legend class="rotulo">Unidades</legend>
        <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">${unidades.map((x) => `
          <label class="flex items-center gap-2 text-sm" title="${esc(x.nome)}">
            <input type="checkbox" name="unidade" value="${esc(x.sigla)}" ${u.unidades.includes(x.sigla) ? 'checked' : ''} />${esc(x.sigla)}</label>`).join('')}
        </div>
      </fieldset>
      ${novo ? '' : `<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''} ${proprio ? 'disabled' : ''} />
        Usuário ativo (desmarque para bloquear o acesso)</label>`}
      ${proprio ? '<p class="text-[13px] text-apagado">Você não pode mudar o perfil nem desativar a própria conta.</p>' : ''}
      ${novo ? '<p class="text-[13px] text-apagado">Ao salvar, o sistema gera uma senha temporária para o primeiro acesso.</p>' : ''}
      <p class="hidden text-sm font-semibold text-alerta" data-erro role="alert"></p>
    </div>
    <div class="mt-7 flex justify-end gap-2">
      <button type="button" class="btn-secundario" data-fechar>Cancelar</button>
      <button type="submit" class="btn-primario px-6" data-salvar>${novo ? 'Criar usuário' : 'Salvar'}</button>
    </div>
  </form>`;
  const form = d.querySelector('form');
  const erro = d.querySelector('[data-erro]');
  const atualizarPerfil = () => {
    const perfil = form.perfil.value;
    d.querySelector('[data-descricao-perfil]').textContent = DESCRICAO_PERFIL[perfil] || '';
    d.querySelector('[data-unidades]').hidden = !PRECISA_UNIDADE.includes(perfil);
  };
  form.perfil.addEventListener('change', atualizarPerfil);
  atualizarPerfil();

  return new Promise((resolver) => {
    let salvou = false;
    d.addEventListener('close', () => resolver(salvou), { once: true });
    d.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => d.close()));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const perfil = form.perfil.value;
      const marcadas = [...form.querySelectorAll('input[name="unidade"]:checked')].map((c) => c.value);
      const dados = { nome: form.nome.value.trim(), perfil, unidades: PRECISA_UNIDADE.includes(perfil) ? marcadas : [] };
      const problema = !dados.nome ? 'Informe o nome.'
        : novo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim()) ? 'Informe um e-mail válido.'
          : PRECISA_UNIDADE.includes(perfil) && !marcadas.length ? 'Marque pelo menos uma unidade.' : null;
      if (problema) {
        erro.textContent = problema;
        erro.classList.remove('hidden');
        return;
      }
      if (proprio) delete dados.perfil;
      if (!novo && !proprio) dados.ativo = form.ativo.checked;
      if (proprio) delete dados.unidades;
      const botao = d.querySelector('[data-salvar]');
      botao.disabled = true;
      try {
        if (novo) {
          const r = await api.criarUsuario({ ...dados, email: form.email.value.trim().toLowerCase() });
          salvou = true;
          d.close();
          mostrarSenha(r);
        } else {
          await api.alterarUsuario(usuario.id, dados);
          salvou = true;
          toast('Usuário atualizado.', 'ok');
          d.close();
        }
      } catch (falha) {
        erro.textContent = falha.message;
        erro.classList.remove('hidden');
      } finally {
        botao.disabled = false;
      }
    });
    d.showModal();
    (novo ? form.email : form.nome).focus();
  });
}

/**
 * Desenha a aba Usuários em `alvo`.
 * emailAtual: e-mail de quem está logado (para não oferecer ações sobre a própria conta).
 * aoErro(e): trata sessão vencida/troca de senha; devolve true se tratou.
 */
export async function renderizarUsuarios(alvo, { emailAtual, aoErro }) {
  alvo.innerHTML = '<p class="py-12 text-center text-sm text-suave">Carregando os usuários…</p>';
  let dados;
  try {
    dados = await api.usuarios();
  } catch (e) {
    if (await aoErro(e)) return;
    alvo.innerHTML = `<div class="cartao px-6 py-12 text-center text-sm text-suave">${esc(e.message)}</div>`;
    return;
  }
  const { usuarios, unidades } = dados;
  const recarregar = () => renderizarUsuarios(alvo, { emailAtual, aoErro });

  alvo.innerHTML = `<section class="cartao p-6">
    <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h3 class="display text-[15px] font-bold">Usuários</h3>
        <p class="mt-1 text-[13px] text-suave">Quem acessa a Área do gestor e o que cada um vê. Mudanças de perfil, unidade ou bloqueio valem na hora.</p>
      </div>
      <button type="button" class="btn-primario" data-novo>Novo usuário</button>
    </div>
    <div class="overflow-x-auto rounded-lg border border-linha"><table class="tabela">
      <thead><tr><th>Nome</th><th>Perfil</th><th>Unidades</th><th>Situação</th><th>Último acesso</th><th class="text-right">Ações</th></tr></thead>
      <tbody>${usuarios.map((u) => `<tr>
        <td><span class="font-semibold">${esc(u.nome)}</span><span class="block text-xs text-apagado">${esc(u.email)}</span></td>
        <td class="text-[13px]">${esc(PERFIS[u.perfil] || u.perfil)}</td>
        <td class="text-[13px]">${PRECISA_UNIDADE.includes(u.perfil) ? esc(u.unidades.join(', ') || '—') : '<span class="text-apagado">todas</span>'}</td>
        <td>${situacao(u)}</td>
        <td class="whitespace-nowrap text-[13px] tabular-nums">${esc(dataHora(u.ultimo_login_em))}</td>
        <td class="whitespace-nowrap text-right">
          <button type="button" class="btn-sutil text-turquesa-700" data-editar="${u.id}">Editar</button>
          ${u.email === emailAtual ? '' : `<button type="button" class="btn-sutil text-turquesa-700" data-senha="${u.id}">Senha temporária</button>`}
        </td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;

  const porId = new Map(usuarios.map((u) => [String(u.id), u]));
  alvo.querySelector('[data-novo]').addEventListener('click', async () => {
    if (await abrirFormulario(null, unidades, emailAtual)) recarregar();
  });
  alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
    if (await abrirFormulario(porId.get(b.dataset.editar), unidades, emailAtual)) recarregar();
  }));
  alvo.querySelectorAll('[data-senha]').forEach((b) => b.addEventListener('click', async () => {
    const u = porId.get(b.dataset.senha);
    if (!confirm(`Gerar uma senha temporária para ${u.nome}? A senha atual deixa de valer e as sessões abertas são encerradas.`)) return;
    try {
      mostrarSenha(await api.senhaTemporaria(u.id));
      recarregar();
    } catch (e) {
      if (!(await aoErro(e))) toast(e.message, 'erro');
    }
  }));
}
