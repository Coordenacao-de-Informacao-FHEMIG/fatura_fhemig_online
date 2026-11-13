-- Fatura Fhemig Online — esquema inicial do banco da Área do gestor.
-- O banco guarda SOMENTE totais das análises (nenhum nome, CPF, CNS ou prontuário).

CREATE TABLE unidade (
  sigla       TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  cnes        TEXT,
  codigo_tasy TEXT
);

CREATE TABLE usuario (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome        TEXT NOT NULL,
  senha_hash  TEXT,                                   -- scrypt; nulo se o login vier do AD/LDAP
  perfil      TEXT NOT NULL CHECK (perfil IN ('faturista', 'gestor_unidade', 'gestor_central', 'admin')),
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usuario_unidade (
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  sigla       TEXT NOT NULL REFERENCES unidade(sigla),
  PRIMARY KEY (usuario_id, sigla)
);

CREATE TABLE sessao (
  token_hash  TEXT PRIMARY KEY,                       -- SHA-256 do token do cookie (o token nunca é gravado)
  usuario_id  INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  criada_em   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  ip          TEXT
);
CREATE INDEX ix_sessao_usuario ON sessao (usuario_id);

CREATE TABLE processamento (
  id                 INTEGER PRIMARY KEY,
  ferramenta         TEXT NOT NULL CHECK (ferramenta IN ('hospitalar', 'ambulatorial', 'checa')),
  sigla              TEXT NOT NULL REFERENCES unidade(sigla),
  competencia        TEXT NOT NULL CHECK (length(competencia) = 6),   -- AAAAMM
  usuario_id         INTEGER REFERENCES usuario(id),
  arquivo_nome       TEXT,
  arquivo_sha256     TEXT NOT NULL,
  sigtap_competencia TEXT,
  versao_regras      TEXT,
  criado_em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  vigente            INTEGER NOT NULL DEFAULT 1       -- o último envio da competência substitui os anteriores
);
CREATE INDEX ix_processamento ON processamento (sigla, competencia, ferramenta, vigente);

CREATE TABLE indicador (
  processamento_id INTEGER NOT NULL REFERENCES processamento(id) ON DELETE CASCADE,
  chave            TEXT NOT NULL,
  valor            REAL NOT NULL,
  PRIMARY KEY (processamento_id, chave)
);

CREATE TABLE alerta_resumo (
  processamento_id INTEGER NOT NULL REFERENCES processamento(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL,
  ocorrencias      INTEGER NOT NULL,
  contas           INTEGER NOT NULL,
  PRIMARY KEY (processamento_id, tipo)
);

CREATE TABLE procedimento_resumo (
  processamento_id INTEGER NOT NULL REFERENCES processamento(id) ON DELETE CASCADE,
  codigo           TEXT NOT NULL,
  descricao        TEXT,
  quantidade       INTEGER NOT NULL,
  PRIMARY KEY (processamento_id, codigo)
);

CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER,
  acao        TEXT NOT NULL,
  detalhe     TEXT,
  ip          TEXT,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_auditoria_data ON auditoria (criado_em);
