-- Contas locais: senha temporária com troca obrigatória e registro do último acesso.

ALTER TABLE usuario ADD COLUMN trocar_senha INTEGER NOT NULL DEFAULT 0;   -- 1 = só pode trocar a senha até definir uma nova
ALTER TABLE usuario ADD COLUMN senha_expira_em TEXT;                       -- validade da senha temporária (nulo = sem prazo)
ALTER TABLE usuario ADD COLUMN ultimo_login_em TEXT;

CREATE INDEX ix_processamento_data ON processamento (criado_em);
