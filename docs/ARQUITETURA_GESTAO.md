# Área do gestor em produção: proposta de arquitetura

> **Estado atual:** a API descrita aqui está implementada em `servidor/` (Node 22, Fastify e o SQLite embutido do Node), com testes em `tests/api.test.js`. A instalação está em [IMPLANTACAO_VM.md](IMPLANTACAO_VM.md), seção 5. No Netlify, onde não há API, a Área do gestor continua como protótipo, com login `teste@gmail.com` / `teste` e dados fictícios (`src/gestao/ficticio.js`).

Este documento descreve a arquitetura da Área do gestor em produção, com o banco de dados **dentro da VM do Governo de MG**.

## Princípio: o banco recebe totais, não pacientes

O processamento continua no navegador, como hoje. Ao concluir uma análise, o navegador envia para a API da VM **somente os totais**:

- AIHs ou linhas BPA por competência;
- contagens por tipo de alerta;
- top de procedimentos (código e quantidade);
- indicadores do ChecaProfissionais;
- metadados: unidade, competência, quem processou, quando e o SHA-256 do arquivo.

Nenhum nome, CPF, CNS ou prontuário sai do navegador. Isso mantém o banco fora do escopo de dado pessoal sensível da LGPD, deixa o volume pequeno e preserva a regra de que o arquivo de produção não é enviado. A CSP continua `connect-src 'self'`, porque a API fica no mesmo domínio.

Se um dia a gestão precisar de detalhe por AIH, isso deve ser uma decisão à parte, com DPO, base legal, pseudonimização e controle de acesso por unidade.

**Decisão (nov/2026):** o acompanhamento dos alertas usa só as **contagens** por tipo de alerta, unidade e competência. O número da AIH não vai para o banco; o detalhe por conta continua no relatório Excel que a unidade baixa no próprio navegador.

## Componentes na VM

```
Navegador (gestores e faturistas)
   │  HTTPS, mesmo domínio
   ▼
nginx (TLS, arquivos estáticos do site, proxy de /api)
   │
   ▼
API (Node.js 22 + Fastify, ou Python + FastAPI)  ── processo único, systemd/NSSM
   │
   ▼
SQLite (arquivo em disco da VM, modo WAL) + backup diário
```

## SQLite serve?

**Sim, com folga, para este uso.** A conta de volume é pequena:

- **Por mês:** cerca de 16 unidades × 3 ferramentas × algumas reprocessadas dão poucas centenas de processamentos.
- **Por processamento:** algumas dezenas de linhas de resumo.
- **Em 10 anos:** abaixo de alguns milhões de linhas, poucos MB a algumas centenas de MB.

O SQLite lida com isso sem esforço. Leitura concorrente é ilimitada, e gravação é uma por vez: com WAL, cada gravação leva milissegundos, o que basta para dezenas de usuários simultâneos.

Vantagens sobre um servidor de banco:

- **Implantação:** não há serviço extra para instalar, atualizar e proteger. O banco é um arquivo na VM.
- **Backup:** `sqlite3 banco.db ".backup copia.db"` roda com o banco em uso. Copie o resultado para o storage institucional.
- **Confiabilidade:** o SQLite é um dos softwares mais testados que existem, com transações ACID completas.

Mudar para **PostgreSQL**, também instalado na VM, vale a pena se:

- a API precisar rodar em mais de uma VM ou contêiner ao mesmo tempo;
- houver muitas gravações concorrentes, por exemplo se se decidir guardar o detalhe de cada linha;
- for preciso conectar ferramentas de BI (Power BI, Metabase) direto no banco com usuários próprios.

Se a API usar uma camada de acesso simples (SQL padrão ou um query builder como Kysely ou Knex), essa troca no futuro é pequena.

## Esquema inicial (SQLite)

```sql
CREATE TABLE unidade (
  sigla TEXT PRIMARY KEY, nome TEXT NOT NULL, cnes TEXT, codigo_tasy TEXT
);
CREATE TABLE usuario (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
  senha_hash TEXT,                 -- scrypt; nulo se o login for via AD/LDAP
  perfil TEXT NOT NULL CHECK (perfil IN ('faturista','gestor_unidade','gestor_central','admin')),
  ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL
);
CREATE TABLE usuario_unidade (usuario_id INTEGER REFERENCES usuario(id), sigla TEXT REFERENCES unidade(sigla),
  PRIMARY KEY (usuario_id, sigla));
CREATE TABLE processamento (
  id INTEGER PRIMARY KEY,
  ferramenta TEXT NOT NULL CHECK (ferramenta IN ('hospitalar','ambulatorial','checa')),
  sigla TEXT NOT NULL REFERENCES unidade(sigla),
  competencia TEXT NOT NULL,       -- AAAAMM
  usuario_id INTEGER REFERENCES usuario(id),
  arquivo_sha256 TEXT NOT NULL,    -- evita contar o mesmo arquivo duas vezes
  sigtap_competencia TEXT, versao_regras TEXT,
  criado_em TEXT NOT NULL,
  vigente INTEGER NOT NULL DEFAULT 1   -- o último reprocessamento da competência substitui o anterior
);
CREATE INDEX ix_proc ON processamento (sigla, competencia, ferramenta, vigente);
CREATE TABLE indicador (processamento_id INTEGER REFERENCES processamento(id), chave TEXT, valor REAL,
  PRIMARY KEY (processamento_id, chave));          -- aihs, aihs_com_alerta, diarias_maior, linhas_bpa...
CREATE TABLE alerta_resumo (processamento_id INTEGER REFERENCES processamento(id), tipo TEXT,
  ocorrencias INTEGER, contas INTEGER, PRIMARY KEY (processamento_id, tipo));
CREATE TABLE procedimento_resumo (processamento_id INTEGER REFERENCES processamento(id), codigo TEXT,
  quantidade INTEGER, PRIMARY KEY (processamento_id, codigo));
CREATE TABLE auditoria (id INTEGER PRIMARY KEY, usuario_id INTEGER, acao TEXT, detalhe TEXT, criado_em TEXT);
```

Os indicadores do painel saem de consultas simples sobre `processamento` com `vigente = 1`, agrupadas por unidade e competência.

## Autenticação

**Implementado: usuários locais** na tabela `usuario`, administrados pela aba **Usuários** (perfil `admin`):

- **Senhas:** guardadas com **scrypt**, com bloqueio após tentativas falhas.
- **Usuário novo ou senha esquecida:** o admin gera uma **senha temporária** (72 h). Até a pessoa definir uma senha própria, a API só aceita a troca de senha (`403` com `codigo: 'trocar_senha'`).
- **Troca pelo próprio usuário:** `POST /api/sessao/senha`, que encerra as outras sessões dele.
- **Mudanças de perfil, unidade ou bloqueio:** valem na hora, porque a sessão relê o usuário no banco a cada requisição.

**Próximo passo, quando a TI liberar: login institucional** (conta Microsoft/Entra ID via OIDC, ou AD/LDAP). Só a autenticação muda. Perfil e unidades continuam no banco local, e só entra quem o admin já cadastrou.

Em qualquer caso:

- **Sessão:** em cookie `HttpOnly`, `Secure`, `SameSite=Strict`, com expiração.
- **Perfis:** o `gestor_unidade` só vê as próprias unidades e o `gestor_central` vê todas. A regra é aplicada na API, nunca só na tela.
- **Auditoria:** registro de login, envio de resumo e consultas do painel.
- **Rede:** HTTPS obrigatório e acesso restrito à rede do Estado, no nginx ou no firewall da VM.

## API mínima

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/saude` | o site usa para saber se a API está no ar |
| POST | `/api/sessao` | login; `GET` devolve o usuário logado; `DELETE` faz logout |
| POST | `/api/processamentos` | o navegador envia o resumo ao fim de cada análise |
| GET | `/api/painel?ate=AAAAMM&meses=6` | totais por unidade e mês para o painel, já filtrados pelo perfil |
| GET | `/api/unidades` | catálogo, filtrado pelo perfil |
| POST | `/api/sessao/senha` | o próprio usuário troca a senha |
| GET | `/api/historico?sigla=&ferramenta=` | envios (vigentes e substituídos), filtrados pelo perfil |
| GET, POST | `/api/usuarios` | só admin: lista e cria (com senha temporária) |
| PATCH | `/api/usuarios/:id` | só admin: nome, perfil, unidades, ativo |
| POST | `/api/usuarios/:id/senha-temporaria` | só admin: redefine a senha |

## Operação na VM

- **Serviço:** a API roda como serviço (systemd no Linux, NSSM ou serviço do Windows), reiniciando sozinha.
- **Banco e backup:** o banco fica em `/var/lib/fatura-fhemig/fatura.db` com permissão só para o usuário do serviço. O backup diário via `.backup` mantém 30 cópias, com cópia fora da VM.
- **Logs:** de acesso e de erro com rotação, sem gravar o conteúdo dos arquivos processados.
- **Atualização:** pare a API, aplique as migrações do esquema (arquivos SQL versionados) e reinicie.

## Próximos passos sugeridos

1. Validar com a gestão os indicadores do protótipo: o que fica, o que falta e com que frequência é consultado.
2. Definir com a TI do Estado o método de login (AD/LDAP ou SSO) e quem administra os perfis.
3. Implementar a API e o esquema acima e trocar o login de teste pela sessão real.
4. Fazer o envio do resumo ao fim de cada análise, opcional e visível ao usuário ("Enviar ao painel gerencial").
