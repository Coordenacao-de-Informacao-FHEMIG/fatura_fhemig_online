# Fatura Fhemig Online

Versão web dos três aplicativos que hoje rodam como `.exe`. Os três ficam numa única página, sem login, com a unidade da FHEMIG selecionada no topo e uma aba por ferramenta:

| Aba | Regras de origem | Entrada | Excel gerado |
| --- | --- | --- | --- |
| **Fatura Hospitalar** | Fatura Fhemig 14.3 | TXT posicional do SISAIH01 ou PDF do espelho da AIH | `Relatorio`, `Dados`, `Alertas`, `Producao` (com gráficos) |
| **Fatura Ambulatorial** | Fatura Fhemig Ambulatorial 1.0 | TXT de produção BPA (BPA-I e BPA-C) | `Relatorio`, `Alertas`, `Producao`, `Parametros` (com gráficos) |
| **ChecaProfissionais** | ChecaProfissionais 2.0 | Relatório do Tasy e planilha do CNES | as 12 abas, de `Resumo_Executivo` a `Parametros` |

**Todo o processamento roda no navegador.** O "backend" é um motor em JavaScript (`src/engine/`) que reúne as três soluções e roda num Web Worker. O servidor só entrega arquivos estáticos. A política de segurança da página (`connect-src 'self'`) impede o envio de qualquer arquivo para outro endereço.

## Paridade com os aplicativos originais

Cada regra foi portada função a função do código Python, e o nome da função original aparece nos comentários. `npm test` roda o motor JS sobre a massa sintética de `../arquivos de teste` e compara com a saída dos backends originais, guardada em `tests/referencia/`:

- **Hospitalar:** alertas por procedimento, detalhes, contagens e resumo de AIHs por tipo e CTI, no TXT e no PDF.
- **Ambulatorial:** abas `Alertas` e `Producao` célula a célula, mais os avisos de cabeçalho.
- **Checa:** alertas com mensagens, matriz de profissionais, indicadores e o erro E002 de unidade incompatível.

Para atualizar as referências depois de mudar uma regra no Python, veja `scripts/paridade/gerar_referencia.py`.

As diferenças em relação aos `.exe` são poucas e intencionais:

- **Unidade.** Vem do seletor no topo da tela.
  - Hospitalar: as regras de HJXXIII e HIJPII valem pela unidade selecionada, e planilhas de outra unidade são recusadas.
  - Checa: Tasy e CNES precisam ser da unidade selecionada.
  - Ambulatorial: avisa quando o CNES do TXT é de outra unidade.
- **SIGTAP no Hospitalar.** Aceita a pasta TXT do DATASUS, como a 14.3, e também a planilha `SIGTAP*.xlsx`, como a 14.1. Na planilha valem as regras da 14.3: idade máxima com os meses até o próximo aniversário e 9999 tratado como "não se aplica". A "Categoria CBO" vem da coluna da planilha, mais ampla que a reconstrução feita a partir do TXT.
- **Excel no Checa.** O SHA-256 dos arquivos de configuração, na aba `Parametros`, é calculado sobre o JSON e não sobre os bytes do arquivo.

## Bases SIGTAP

| Base | Arquivo | Uso |
| --- | --- | --- |
| TXT DATASUS 09/2026 | `public/sigtap/sigtap_202609.dat` | Hospitalar e Ambulatorial |
| Planilha `SIGTAP102026.xlsx` | `public/sigtap/sigtap_202610_planilha.dat` | Hospitalar e Ambulatorial |

- **Escolha sempre automática.** O usuário não escolhe o SIGTAP. Cada análise usa a base da **mesma competência** do TXT/PDF/BPA; se não houver, a **competência anterior mais próxima** disponível. Só se não existir nenhuma anterior usa a posterior mais antiga, com aviso no log. Na mesma competência, o TXT do DATASUS tem preferência sobre a planilha. Regra em `escolherSigtapPorCompetencia` (`src/engine/sigtap/sigtap.js`), com testes em `tests/sigtap-competencia.test.js`.
- **Nova competência.** Gere a base embutida e refaça o build:
  ```bash
  npm run sigtap -- "caminho/da/pasta/Sigtap" "caminho/SIGTAPMMAAAA.xlsx"
  ```

## Bases das unidades

São as planilhas que ficavam ao lado do `.exe`: Serviço/Classificação, Habilitações, Profissionais e Carga horária (e ADC/CBO do Checa). Ficam **embutidas** no site, na pasta `bases/` do build (`dist/bases/…`, listadas em `bases/manifest.json`), e são carregadas sozinhas para a unidade selecionada. **O usuário não seleciona nem substitui planilhas**: envia apenas o arquivo de produção. Se a unidade ainda não tiver uma planilha, a tela mostra "Indisponível" e o processamento fica bloqueado até o administrador incluí-la.

| Modo | Origem das bases | Pasta | Uso |
| --- | --- | --- | --- |
| `netlify` | Só os dados **simulados** de `../arquivos de teste` | `dados/netlify/` (versionada) | Ambiente de testes, com botões "Modo demonstração" |
| `vm` | Planilhas reais colocadas em `dados/vm/bases/<ferramenta>/<SIGLA>/` e `dados/vm/bases/checa/` | `dados/vm/` (fora do git, exceto Habilitação e Serviço/Classificação) | VM do Governo de MG |

No modo `vm`, a pasta `dados/vm/bases/` é a fonte: o tipo de cada planilha sai do nome do arquivo e a unidade, do nome da pasta. O `build:vm` e o `dev:vm` refazem o `bases/manifest.json` sozinhos (`scripts/preparar-vm.mjs`). Unidade nova é só uma pasta nova com a sigla. Regras de nome e lista do que pedir à coordenação: [`dados/vm/LEIA-ME.md`](dados/vm/LEIA-ME.md).

Habilitação e Serviço/Classificação reais estão versionadas: são cadastro da unidade, sem dados pessoais. Profissionais, Carga horária e ADC têm nome, CPF e CNS de servidores, por isso ficam fora do git, que é público, e nunca vão para o Netlify. Em cada computador novo, copie essas planilhas para `dados/vm/bases/`.

## Área do gestor (API)

O painel gerencial lê os totais que as unidades enviam ao fim de cada análise (botão **Enviar ao painel gerencial**). Só vão indicadores, tipos de alerta e procedimentos mais realizados, nunca dados de pacientes ou profissionais. A API fica em `servidor/` (Node 22, Fastify e o SQLite embutido do Node) e roda só na VM. No Netlify não há API, e a Área do gestor mostra o protótipo com dados fictícios.

Para testar localmente:

```bash
npm run api:demo
```

```bash
npm run api:dev
```

Com `npm run dev` rodando junto, o site encaminha `/api` para a API. O login de teste é `teste@gmail.com` / `teste`. Instalação na VM, usuários, segurança e backup: [docs/IMPLANTACAO_VM.md](docs/IMPLANTACAO_VM.md), seção 5.

## Comandos

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run build:vm
```

```bash
npm run preview
```

| Comando | O que faz |
| --- | --- |
| `npm install` | Instala as dependências |
| `npm run dev` | Desenvolvimento em http://localhost:5173 (modo netlify) |
| `npm run dev:vm` | Desenvolvimento com as bases **reais** de `dados/vm` (Profissionais e Carga horária ficam só neste computador). Use para testar contas reais localmente |
| `npm test` | Testes de paridade com os `.exe` |
| `npm run build` | Gera `dist/`, o build do Netlify (só dados simulados) |
| `npm run build:vm` | Gera `dist-vm/`, o build da VM (bases reais) |
| `npm run preview` | Serve o `dist/` com os mesmos cabeçalhos de segurança da produção |

A implantação na VM está descrita em [docs/IMPLANTACAO_VM.md](docs/IMPLANTACAO_VM.md).

## Estrutura

```
src/
  main.js, styles.css      interface (Tailwind 4, identidade FHEMIG, glassmorphism)
  ui/                      componentes da tela, resultados e gráficos (Chart.js)
  worker.js                motor em Web Worker (bases e SIGTAP embutidos)
  engine/
    comum/                 texto (equivalente ao Python), leitor de xlsx, gravação de xlsx + gráficos nativos
    sigtap/                base SIGTAP (TXT DATASUS, base compacta e planilha)
    hospitalar/            entrada (SISAIH01 e PDF), regras e alertas, relatório
    ambulatorial/          leitor BPA, planilhas, regras R01-R11, relatório (+ config/*.json originais)
    checa/                 leitura, regras, relatório (+ config/*.json originais)
    unidades.js            catálogo único das unidades
  gestao/                  resumo enviado ao painel (só totais), montagem do painel, dados fictícios, cliente da API
servidor/                  API da Área do gestor (Fastify + SQLite), migrações, linha de comando de usuários
public/                    marca, fotos (fundo), bases SIGTAP compactas
dados/netlify|vm/          bases das unidades e exemplos por modo de build
dados-api/                 banco SQLite local de testes (fora do git)
scripts/                   build, preparo de dados, bases SIGTAP, referências de paridade
tests/                     Vitest de paridade, escolha do SIGTAP e API
```

## Identidade visual

- **Cores:** turquesa `#0092C3`/`#00AFD2` e azul-escuro `#00486C` sobre fundo branco.
- **Tipografia:** Open Sans no texto e Google Sans Flex com largura 125% em títulos e números. As duas ficam hospedadas localmente, via Fontsource.
- **Logo e fundo:** o logo da FHEMIG vem do pacote original. O fundo usa uma ilustração provisória (`public/fotos/fundo.svg`). Para usar foto oficial esmaecida, grave `public/fotos/fundo.jpg` e troque a URL em `src/styles.css` (classe `.fundo`).
- **Marcas do SUS e do Governo de Minas:** os vetores foram tirados dos manuais oficiais; a origem de cada arquivo está em [public/marca/FONTES.md](public/marca/FONTES.md). Elas aparecem no rodapé em qualquer tela e no cabeçalho a partir de 1536 px. A lista fica em `public/marca/marcas.json`.
