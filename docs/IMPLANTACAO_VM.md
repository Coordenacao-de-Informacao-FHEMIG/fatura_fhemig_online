# Implantação na máquina virtual do Governo de MG

O Fatura Fhemig Online tem duas partes:

- **Site estático** (obrigatório): as três ferramentas. Basta um servidor web (nginx, IIS ou Apache). O processamento acontece no navegador de cada usuário.
- **API da Área do gestor** (opcional): um processo Node 22 com banco SQLite, que recebe **só os totais** das análises e serve o painel gerencial. O banco fica num arquivo da própria VM. Ver a seção 5.

> **Por enquanto a Área do gestor está desligada** (`GESTOR_EM_DESENVOLVIMENTO = true` em `src/main.js`): o botão aparece acinzentado com a dica "Em desenvolvimento" e o site não chama `/api`. Basta publicar o site estático (seções 1 a 4). Para religar, mude para `false`, gere o pacote de novo e instale a API (seção 5).

**Vai para a VM o pacote `dist-vm/`, não a pasta do projeto.** A VM só precisa servir arquivos estáticos: não precisa de Node, git nem do código-fonte. E o repositório do GitHub não tem as planilhas com dados pessoais (ficam fora do git), então um clone na VM não teria as bases das unidades.

O site precisa ser servido em **HTTPS**: o navegador só calcula o SHA-256 do arquivo (usado para não contar o mesmo envio duas vezes) em contexto seguro.

## 1. Gerar o pacote

Numa máquina com Node 22.13 ou mais novo e a pasta do projeto:

1. **Planilhas:** a **base geral** do faturamento (todas as unidades; abas Serviço/Classificação, Habilitações, Profissionais e CBOs assistenciais) vai em `dados/vm/geral/`. A base ADC do ChecaProfissionais vai em `dados/vm/bases/checa/`, e planilhas por unidade em `dados/vm/bases/` só para o que a base geral não cobrir. O passo a passo, os nomes aceitos e o que pedir à coordenação de faturamento estão em [`dados/vm/LEIA-ME.md`](../dados/vm/LEIA-ME.md).
2. **SIGTAP:** as competências publicadas ficam em `public/sigtap/` (ver a seção 4).
3. **Build:**

```bash
npm ci
```

```bash
npm run build:vm
```

O build lista o que encontrou por unidade e avisa o que falta. Ele para com erro se houver pasta com sigla desconhecida, duas planilhas do mesmo tipo na mesma pasta ou planilha com a sigla de outra unidade no nome.

O resultado fica em `dist-vm/`: a aplicação, as bases SIGTAP e `bases/`, só com as planilhas listadas em `bases/manifest.json`. O modo demonstração não existe nesse build.

> `dist-vm/bases/` contém nome e CNS de servidores (base geral das unidades, `bases/geral/base-geral.json`, e eventuais planilhas de Profissionais, Carga horária e ADC). Copie a pasta só para a VM, por canal interno. Não publique fora da rede do Estado nem envie para o Netlify.

## 2. Publicar

Copie o **conteúdo** de `dist-vm/` (não a pasta em si) para a raiz do site, por exemplo `/var/www/fatura-fhemig`, por canal interno (WinSCP, `scp` ou pasta de rede). Numa atualização, apague o conteúdo antigo antes de copiar: os nomes dos arquivos em `assets/` mudam a cada build.

O site também funciona numa **subpasta** do servidor (por exemplo `http://10.x.x.x/fatura_fhemig/`): todos os caminhos do build são relativos. Abra o endereço com a barra no final (`.../fatura_fhemig/`).

```bash
sudo rm -rf /var/www/fatura-fhemig/* && sudo cp -r dist-vm/* /var/www/fatura-fhemig/ && sudo chown -R root:www-data /var/www/fatura-fhemig && sudo chmod -R a+rX,go-w /var/www/fatura-fhemig
```

(Use o grupo do nginx da distribuição: `www-data` no Ubuntu/Debian, `nginx` no RHEL.)

### nginx

```nginx
server {
    listen 443 ssl;
    server_name fatura.fhemig.mg.gov.br;   # ajustar
    root /var/www/fatura-fhemig;
    index index.html;

    # Restringir à rede interna do Estado (ajustar as faixas)
    # allow 10.0.0.0/8;
    # deny all;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
    location ~* \.mjs$ { types { application/javascript mjs; } }
    location /sigtap/ { types { application/octet-stream dat; application/json json; } }
    location /bases/  { add_header Cache-Control "no-cache"; }
}
```

### IIS

- **Arquivos:** copie `dist-vm/` para o site.
- **Tipos MIME** (Tipos MIME do IIS):
  - `.mjs` = `application/javascript`
  - `.dat` = `application/octet-stream`
  - `.woff2` = `font/woff2`
  - `.json` = `application/json`
- **Cabeçalhos de resposta HTTP:** adicione os mesmos `Content-Security-Policy`, `X-Content-Type-Options` e `Referrer-Policy` do bloco nginx.

## 3. Conferir depois de publicar

1. **Página e unidades:** abra o endereço e selecione HJXXIII, HIJPII ou HRBJA. As planilhas da unidade devem aparecer com a etiqueta "Embutida" e o SIGTAP como "Automática".
2. **Teste do fluxo:** processe um arquivo da pasta `arquivos de teste`. Na VM ele é conferido contra as planilhas reais da unidade, então os alertas não batem com o gabarito do Netlify; serve só para ver o fluxo funcionando.
3. **Nada sai da rede:** no navegador (F12 › Rede), confirme que não há nenhuma requisição para fora do domínio do site.

## 4. Atualizações

- **SIGTAP:** gere as bases com `npm run sigtap -- "<pasta Sigtap>" "<SIGTAPMMAAAA.xlsx>"`, refaça o `build:vm` e publique. Não há importação pela tela: a escolha é automática (mesma competência da produção ou a anterior mais próxima), então basta manter as competências novas publicadas em `sigtap/`.
- **Bases das unidades:** substitua a planilha em `dados/vm/bases/<ferramenta>/<SIGLA>/` (sem deixar a antiga ao lado), refaça o `build:vm` e publique. Unidade nova é só uma pasta nova com a sigla, sem mexer em código. Também é possível substituir só o arquivo em `bases/…` na VM, desde que se mantenha exatamente o nome listado em `bases/manifest.json` (o Linux diferencia maiúsculas, minúsculas e acentos).
- **Regras:** mude o motor em `src/engine/`, atualize as referências de paridade (`scripts/paridade/gerar_referencia.py`) e confirme `npm test` antes de publicar.

## 5. API da Área do gestor (painel gerencial)

### O que ela guarda

Só totais de cada análise que a unidade decidir enviar (botão **Enviar ao painel gerencial**, que aparece no resultado quando a API está no ar): indicadores, contagem por tipo de alerta, os 10 procedimentos mais realizados (código, descrição e quantidade), unidade, competência, quem enviou, quando e o SHA-256 do arquivo. A API recusa qualquer campo fora desse formato (por exemplo, nome de paciente ou número de AIH). Nenhum arquivo de produção é enviado.

O último envio de uma unidade, competência e ferramenta substitui o anterior. Reenviar o mesmo arquivo não duplica nada.

### Perfis

| Perfil | Envia resumos | Vê o painel |
| --- | --- | --- |
| `faturista` | das unidades dele | não |
| `gestor_unidade` | das unidades dele | só das unidades dele |
| `gestor_central` | de todas | de todas |
| `admin` | de todas | de todas |

As regras valem na API, não só na tela. Os usuários são criados pela linha de comando, na VM.

### Instalação (Linux)

Precisa de Node **22.13 ou mais novo** (usa o SQLite embutido do Node, `node:sqlite`).

```bash
sudo useradd --system --home /opt/fatura-fhemig fatura
```

```bash
sudo mkdir -p /opt/fatura-fhemig /var/lib/fatura-fhemig && sudo chown fatura: /var/lib/fatura-fhemig && sudo chmod 700 /var/lib/fatura-fhemig
```

Copie para `/opt/fatura-fhemig` as pastas `servidor/` e `src/` e os arquivos `package.json` e `package-lock.json`. Depois:

```bash
cd /opt/fatura-fhemig && npm ci --omit=dev
```

Serviço systemd (`/etc/systemd/system/fatura-api.service`):

```ini
[Unit]
Description=Fatura Fhemig Online - API da Area do gestor
After=network.target

[Service]
User=fatura
WorkingDirectory=/opt/fatura-fhemig
Environment=NODE_ENV=production
Environment=FATURA_DB=/var/lib/fatura-fhemig/fatura.db
Environment=FATURA_HOST=127.0.0.1
Environment=FATURA_PORTA=3001
Environment=FATURA_CONFIAR_PROXY=1
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning servidor/index.mjs
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/fatura-fhemig

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now fatura-api
```

No Windows Server, rode o mesmo comando como serviço com o NSSM, com as mesmas variáveis de ambiente.

No bloco `server` do nginx da seção 2, encaminhe `/api`. A API só escuta em 127.0.0.1:

```nginx
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 256k;
    }
```

### Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `FATURA_DB` | `dados-api/fatura.db` | arquivo do banco |
| `FATURA_HOST` / `FATURA_PORTA` | `127.0.0.1` / `3001` | onde a API escuta |
| `FATURA_HORAS_SESSAO` | `8` | validade do login |
| `FATURA_SENHA_TEMP_HORAS` | `72` | validade da senha temporária gerada pelo admin |
| `FATURA_CONFIAR_PROXY` | desligado | `1` atrás do nginx, para registrar o IP real na auditoria |
| `FATURA_ORIGENS` | mesmo host | lista de origens aceitas em escrita, se o site tiver mais de um endereço |
| `FATURA_COOKIE_SEGURO` | ligado | `0` só para testes em http://localhost |
| `FATURA_LOG` | ligado | `0` desliga o log de acesso |

### Usuários

**1. Primeiro administrador**, uma vez só, pela linha de comando na VM:

```bash
cd /opt/fatura-fhemig && sudo -u fatura FATURA_DB=/var/lib/fatura-fhemig/fatura.db npm run api:cli -- usuario:criar --email nome@fhemig.mg.gov.br --nome "Nome Sobrenome" --perfil admin
```

A senha é pedida no terminal (mínimo de 10 caracteres, com letras e números).

**2. Demais usuários**, pela tela: o admin entra na Área do gestor e abre a aba **Usuários**.
- **Novo usuário:** e-mail, nome, perfil e unidades. O sistema gera uma **senha temporária**, mostrada uma única vez, para o admin repassar por canal interno. No primeiro acesso, a pessoa é obrigada a definir uma senha própria; até lá, a API recusa todo o resto.
- **Editar:** muda nome, perfil, unidades ou bloqueia o acesso. Vale na hora, inclusive para quem já está logado.
- **Esqueceu a senha:** botão **Senha temporária**. A senha antiga deixa de valer e as sessões abertas são encerradas.
- **Proteções:** o admin não desativa nem rebaixa a própria conta, e o sistema sempre mantém um admin ativo.

Cada usuário troca a própria senha pelo botão **Trocar senha**.

**Pela linha de comando (reserva):** `usuario:senha --email … --temporaria` gera uma senha temporária (útil se o único admin perder o acesso). Outros comandos: `usuario:senha`, `usuario:desativar`, `usuario:ativar`, `usuario:listar` e `auditoria`.

**Nunca** rode `npm run api:demo` na VM. Ele cria o usuário de teste `teste@gmail.com` / `teste` e dados fictícios; existe só para testes locais e se recusa a rodar com `NODE_ENV=production` ou num banco que já tenha envios reais.

### Segurança

- **Senhas:** guardadas com scrypt, nunca em texto.
- **Sessão:** token aleatório num cookie `HttpOnly`, `Secure`, `SameSite=Strict`, restrito a `/api`. O banco guarda só o hash do token.
- **Login:** bloqueado por 15 minutos após 5 tentativas erradas do mesmo IP e e-mail.
- **Escrita:** só é aceita vinda do próprio site (conferência do cabeçalho `Origin`).
- **Senha temporária:** vale 72 horas (`FATURA_SENHA_TEMP_HORAS`) e obriga a troca no primeiro acesso.
- **Auditoria:** login, falhas de login, trocas e redefinições de senha, mudanças de usuário, envios e consultas ao painel e ao histórico ficam registrados na tabela `auditoria`.
- **Fora do ar:** sem a API, o build da VM avisa que o painel está indisponível. Ele nunca mostra o protótipo.
- **Login institucional (Microsoft, AD):** ainda não implementado. Quando a TI liberar, a troca é na rota `POST /api/sessao` (`servidor/app.mjs`). Perfis e unidades continuam no banco local.

### Backup

O SQLite permite copiar o banco em uso. Instale o `sqlite3` (`sudo apt install sqlite3` ou `sudo dnf install sqlite`) e crie a pasta `sudo mkdir -p /var/backups/fatura && sudo chown fatura: /var/backups/fatura`.

Script `/usr/local/bin/fatura-backup` (mantém 30 cópias):

```bash
#!/bin/sh
set -e
sqlite3 /var/lib/fatura-fhemig/fatura.db ".backup '/var/backups/fatura/fatura-$(date +%F).db'"
ls -1t /var/backups/fatura/fatura-*.db | tail -n +31 | xargs -r rm --
```

Agendamento diário com systemd (`/etc/systemd/system/fatura-backup.service` e `.timer`):

```ini
# fatura-backup.service
[Unit]
Description=Backup do banco do Fatura Fhemig Online

[Service]
Type=oneshot
User=fatura
ExecStart=/usr/local/bin/fatura-backup
```

```ini
# fatura-backup.timer
[Unit]
Description=Backup diário do Fatura Fhemig Online

[Timer]
OnCalendar=*-*-* 02:30
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo chmod 755 /usr/local/bin/fatura-backup && sudo systemctl daemon-reload && sudo systemctl enable --now fatura-backup.timer
```

Leve também uma cópia para fora da VM (storage institucional). No Windows Server, use o Agendador de Tarefas com o mesmo comando `sqlite3`.

### Atualização

Pare o serviço, copie as novas versões de `servidor/` e `src/` e inicie de novo. As migrações em `servidor/migracoes/NNN_*.sql` são aplicadas sozinhas ao iniciar, em ordem e uma vez só.
