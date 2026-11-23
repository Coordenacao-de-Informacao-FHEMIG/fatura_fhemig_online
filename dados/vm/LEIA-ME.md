# Planilhas reais das unidades (build da VM)

Coloque aqui as planilhas que a coordenação de faturamento enviar. O `npm run build:vm` lê estas pastas, monta `bases/manifest.json` e leva para o pacote `dist-vm/` só o que reconheceu.

```
dados/vm/
├── geral/                               BASE GERAL: um arquivo só, todas as unidades
│   └── DADOS CNES-UNIDADES_ddmmaaaa.xlsx
└── bases/
    ├── hospitalar/<SIGLA>/              planilhas por unidade (só o que a base geral não cobrir)
    ├── ambulatorial/<SIGLA>/            idem
    ├── checa/                           Profissionais ADC.xlsx (o CBO assistencial vem da base geral)
    └── geral/                           GERADO pelo build a partir de dados/vm/geral (não edite)
        ├── base-geral.json
        └── CBO_assistencial.xlsx
```

## Base geral (`dados/vm/geral/`)

A planilha que o faturamento envia com **todas as unidades**. As abas são reconhecidas pelo cabeçalho (o nome da aba não importa):

| Aba | Colunas | Vira, para cada unidade |
| --- | --- | --- |
| Serviço/Classificação | UNIDADE, Código (`149 - 015`), Serviço, Classificação, Terceiro, CNES | Serviço e Classificação (Hospitalar e Ambulatorial) |
| Habilitações | UNIDADE, Código, Descrição, Origem, Competência Inicial, Competência Final, Portaria | Habilitações (Hospitalar e Ambulatorial) |
| Profissionais (relatório do CNES) | UNIDADE, Nome, CNS, CBO, Descrição, Vinculação, CH Outro, CH Amb., CH Hosp. | Profissionais (Hospitalar e Ambulatorial) e Carga horária (Ambulatorial) |
| CBOs assistenciais | CBO, Descrição (sem UNIDADE) | CBO assistencial do ChecaProfissionais (todos marcados como assistenciais) |

Na análise, o site pega só as linhas da unidade selecionada. Quando a base geral cobre uma unidade, ela vale no lugar das planilhas da pasta da unidade (o build avisa quais foram ignoradas).

- **Formato:** `.xlsx` (também aceita `.csv` só com os profissionais).
- **Limpeza automática:** valem as linhas com sigla do catálogo; o código de habilitação vira 4 dígitos (`903` → `0903`); nos profissionais, CNS com 15 dígitos e CBO com 6 caracteres (inclui residentes, como `2231F9`). As linhas quebradas do relatório (só um pedaço do texto do vínculo) são descartadas.
- **Grafias aceitas:** `HXXIII` é lido como HJXXIII (lista em `APELIDOS`, `scripts/base-geral.mjs`). Outra sigla fora do catálogo é ignorada com aviso.
- **Um arquivo só:** para atualizar, substitua o arquivo; não deixe o antigo ao lado.

## Planilhas por unidade (`dados/vm/bases/`)

Só para o que a base geral não cobrir (uma unidade que não aparece nela, por exemplo).


- **Pasta da unidade:** a sigla do catálogo (`src/engine/checa/config/unidades.json`): HJXXIII, HIJPII, HAC, MOV, IRS, HJK, CHPB, CSSFA, HRJP, CSSI, HCM, HEM, CSPD, HRAD, CSSFE, HRBJA.
- **Tipo da planilha:** sai do nome do arquivo. Ele precisa conter `Serviço`, `Habilitação`, `Profissionais` ou `Carga` (no Checa, `ADC` ou `CBO`). Acento e maiúsculas não importam.
- **Sigla no nome:** recomendada (`Habilitações HJXXIII.xlsx`). Se o nome tiver a sigla de outra unidade, o build para.
- **Uma planilha de cada tipo por pasta.** Para atualizar, substitua o arquivo; não deixe a versão antiga ao lado.
- **Formato:** `.xlsx` ou `.xlsm`, no mesmo formato usado pelos aplicativos antigos (Fatura Hospitalar 14.3, Fatura Ambulatorial 1.0 e ChecaProfissionais 2.0).
- **Unidade incompleta:** o build avisa o que falta e a ferramenta fica bloqueada para aquela unidade até a planilha chegar.

Para conferir sem gerar o pacote: `node scripts/preparar-dados.mjs vm`.

## Dados pessoais

A base geral (aba Profissionais), Profissionais, Carga horária e ADC têm nome, CPF e CNS de servidores. O `.gitignore` deixa esses arquivos fora do git (o repositório é público), e também qualquer `.csv`/`.xlsx` solto na raiz do projeto. Só Habilitação e Serviço/Classificação são versionadas. Receba e repasse esses arquivos apenas por canal interno do Estado.
