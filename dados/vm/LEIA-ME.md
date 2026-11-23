# Planilhas reais das unidades (build da VM)

Coloque aqui as planilhas que a coordenação de faturamento enviar. O `npm run build:vm` lê estas pastas, monta `bases/manifest.json` e leva para o pacote `dist-vm/` só o que reconheceu.

```
dados/vm/
├── geral/                               BASE GERAL de profissionais: um arquivo só, todas as unidades
│   └── DADOS CNES-UNIDADES_ddmmaaaa(PROFISSIONAIS).csv
└── bases/
    ├── hospitalar/
    │   └── HJXXIII/                     uma pasta por unidade, com a sigla
    │       ├── Serviço e Classificação HJXXIII.xlsx
    │       └── Habilitações HJXXIII.xlsx
    ├── ambulatorial/
    │   └── HRBJA/
    │       ├── Serviço Classificação HRBJA.xlsx
    │       └── Habilitações HRBJA.xlsx
    ├── checa/                           uma vez só, vale para todas as unidades
    │   ├── Profissionais ADC.xlsx
    │   └── CBO_assistencial.xlsx
    └── geral/profissionais.json         GERADO pelo build a partir de dados/vm/geral (não edite)
```

## Base geral de profissionais (`dados/vm/geral/`)

O relatório de profissionais do CNES com **todas as unidades** numa planilha só. Para cada unidade que aparece nele, o sistema usa essa base como:

- **Profissionais** do Fatura Hospitalar e do Fatura Ambulatorial;
- **Carga horária** do Fatura Ambulatorial (colunas CH Outro, CH Amb. e CH Hosp.).

Na análise, o site pega só as linhas da unidade selecionada. Se a mesma unidade também tiver uma planilha de Profissionais ou Carga horária na pasta dela, a base geral é que vale (o build avisa).

- **Formato:** `.csv` (como o relatório exportado; aceita UTF-8 ou o padrão do Excel) ou `.xlsx`.
- **Colunas:** `UNIDADE` (sigla), `Nome`, `CNS`, `CBO`, `Descrição`, `Vinculação`, `CH Outro`, `CH Amb.`, `CH Hosp.`. Obrigatórias: UNIDADE, CNS e CBO.
- **Limpeza automática:** valem as linhas com sigla do catálogo, CNS com 15 dígitos e CBO com 6 caracteres (inclui residentes, como `2231F9`). As linhas quebradas do relatório (só um pedaço do texto do vínculo) são descartadas.
- **Um arquivo só:** para atualizar, substitua o arquivo; não deixe o antigo ao lado.

## Planilhas por unidade (`dados/vm/bases/`)

- **Pasta da unidade:** a sigla do catálogo (`src/engine/checa/config/unidades.json`): HJXXIII, HIJPII, HAC, MOV, IRS, HJK, CHPB, CSSFA, HRJP, CSSI, HCM, HEM, CSPD, HRAD, CSSFE, HRBJA.
- **Tipo da planilha:** sai do nome do arquivo. Ele precisa conter `Serviço`, `Habilitação`, `Profissionais` ou `Carga` (no Checa, `ADC` ou `CBO`). Acento e maiúsculas não importam.
- **Sigla no nome:** recomendada (`Habilitações HJXXIII.xlsx`). Se o nome tiver a sigla de outra unidade, o build para.
- **Uma planilha de cada tipo por pasta.** Para atualizar, substitua o arquivo; não deixe a versão antiga ao lado.
- **Formato:** `.xlsx` ou `.xlsm`, no mesmo formato usado pelos aplicativos antigos (Fatura Hospitalar 14.3, Fatura Ambulatorial 1.0 e ChecaProfissionais 2.0).
- **Unidade incompleta:** o build avisa o que falta e a ferramenta fica bloqueada para aquela unidade até a planilha chegar.

Para conferir sem gerar o pacote: `node scripts/preparar-dados.mjs vm`.

## Dados pessoais

A base geral, Profissionais, Carga horária e ADC têm nome, CPF e CNS de servidores. O `.gitignore` deixa esses arquivos fora do git (o repositório é público), e também qualquer `.csv`/`.xlsx` solto na raiz do projeto. Só Habilitação e Serviço/Classificação são versionadas. Receba e repasse esses arquivos apenas por canal interno do Estado.
